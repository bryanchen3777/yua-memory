import { DatabaseSync } from 'node:sqlite';

const currentDb = 'C:\\Users\\bbfcc\\.openclaw\\lcm.db';
const backupDb = 'C:\\Users\\bbfcc\\.openclaw\\backups\\lcm.db.v0.4.bak';

console.log('=== LCM Database Merge ===\n');

const db = new DatabaseSync(currentDb);
db.exec(`ATTACH '${backupDb}' AS backup`);

try {
  // Get current counts
  const currentConvIds = db.prepare('SELECT conversation_id FROM conversations').all().map(r => r.conversation_id);
  const currentMsgIds = db.prepare('SELECT message_id FROM messages').all().map(r => r.message_id);
  const currentPartIds = db.prepare('SELECT part_id FROM message_parts').all().map(r => r.part_id);
  
  console.log('Current state:');
  console.log('  Conversations:', currentConvIds.length);
  console.log('  Messages:', currentMsgIds.length);
  console.log('  Message parts:', currentPartIds.length);
  
  const backupConvCount = db.prepare('SELECT COUNT(*) as c FROM backup.conversations').get().c;
  const backupMsgCount = db.prepare('SELECT COUNT(*) as c FROM backup.messages').get().c;
  const backupPartCount = db.prepare('SELECT COUNT(*) as c FROM backup.message_parts').get().c;
  const backupSumCount = db.prepare('SELECT COUNT(*) as c FROM backup.summaries').get().c;
  
  console.log('\nBackup state:');
  console.log('  Conversations:', backupConvCount);
  console.log('  Messages:', backupMsgCount);
  console.log('  Message parts:', backupPartCount);
  console.log('  Summaries:', backupSumCount);
  
  // Start transaction
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  
  // Find and insert new conversations
  const newConversations = db.prepare(`
    SELECT * FROM backup.conversations 
    WHERE conversation_id NOT IN (SELECT conversation_id FROM conversations)
  `).all();
  console.log('\nAdding', newConversations.length, 'new conversations...');
  
  const insertConv = db.prepare(`
    INSERT INTO conversations (conversation_id, session_id, session_key, title, bootstrapped_at, created_at, updated_at)
    VALUES (@conversation_id, @session_id, @session_key, @title, @bootstrapped_at, @created_at, @updated_at)
  `);
  
  let convAdded = 0;
  for (const conv of newConversations) {
    try {
      insertConv.run(conv);
      convAdded++;
    } catch (e) {
      // Skip duplicates
    }
  }
  console.log('  Added', convAdded, 'conversations');
  
  // Get new conversation IDs
  const newConvIds = newConversations.map(c => c.conversation_id);
  
  if (newConvIds.length > 0) {
    // Insert new messages for new conversations
    const placeholders = newConvIds.map(() => '?').join(',');
    const newMessages = db.prepare(`
      SELECT * FROM backup.messages 
      WHERE conversation_id IN (${placeholders})
      AND message_id NOT IN (SELECT message_id FROM messages)
    `).all(...newConvIds);
    console.log('\nAdding', newMessages.length, 'new messages...');
    
    const insertMsg = db.prepare(`
      INSERT INTO messages (message_id, conversation_id, seq, role, content, token_count, created_at)
      VALUES (@message_id, @conversation_id, @seq, @role, @content, @token_count, @created_at)
    `);
    
    let msgAdded = 0;
    for (const msg of newMessages) {
      try {
        insertMsg.run(msg);
        msgAdded++;
      } catch (e) {
        // Skip duplicates
      }
    }
    console.log('  Added', msgAdded, 'messages');
    
    // Insert new message_parts for new messages
    const newMsgIds = newMessages.map(m => m.message_id);
    if (newMsgIds.length > 0) {
      const msgPlaceholders = newMsgIds.map(() => '?').join(',');
      const newParts = db.prepare(`
        SELECT * FROM backup.message_parts 
        WHERE message_id IN (${msgPlaceholders})
        AND part_id NOT IN (SELECT part_id FROM message_parts)
      `).all(...newMsgIds);
      console.log('\nAdding', newParts.length, 'new message parts...');
      
      const insertPart = db.prepare(`
        INSERT INTO message_parts (part_id, message_id, session_id, part_type, ordinal, text_content, is_ignored, is_synthetic, tool_call_id, tool_name, tool_status, tool_input, tool_output, tool_error, tool_title, patch_hash, patch_files, file_mime, file_name, file_url, subtask_prompt, subtask_desc, subtask_agent, step_reason, step_cost, step_tokens_in, step_tokens_out, snapshot_hash, compaction_auto, metadata)
        VALUES (@part_id, @message_id, @session_id, @part_type, @ordinal, @text_content, @is_ignored, @is_synthetic, @tool_call_id, @tool_name, @tool_status, @tool_input, @tool_output, @tool_error, @tool_title, @patch_hash, @patch_files, @file_mime, @file_name, @file_url, @subtask_prompt, @subtask_desc, @subtask_agent, @step_reason, @step_cost, @step_tokens_in, @step_tokens_out, @snapshot_hash, @compaction_auto, @metadata)
      `);
      
      let partAdded = 0;
      for (const part of newParts) {
        try {
          insertPart.run(part);
          partAdded++;
        } catch (e) {
          // Skip duplicates
        }
      }
      console.log('  Added', partAdded, 'message parts');
    }
    
    // Insert new summaries for new conversations
    const newSumConvs = newConversations.map(c => c.conversation_id);
    const sumPlaceholders = newSumConvs.map(() => '?').join(',');
    const newSummaries = db.prepare(`
      SELECT * FROM backup.summaries
      WHERE conversation_id IN (${sumPlaceholders})
      AND summary_id NOT IN (SELECT summary_id FROM summaries)
    `).all(...newSumConvs);
    console.log('\nAdding', newSummaries.length, 'new summaries...');
    
    const insertSum = db.prepare(`
      INSERT INTO summaries (summary_id, conversation_id, kind, depth, content, token_count, earliest_at, latest_at, descendant_count, descendant_token_count, source_message_token_count, created_at, file_ids, model)
      VALUES (@summary_id, @conversation_id, @kind, @depth, @content, @token_count, @earliest_at, @latest_at, @descendant_count, @descendant_token_count, @source_message_token_count, @created_at, @file_ids, @model)
    `);
    
    let sumAdded = 0;
    for (const sum of newSummaries) {
      try {
        insertSum.run(sum);
        sumAdded++;
      } catch (e) {
        // Skip duplicates
      }
    }
    console.log('  Added', sumAdded, 'summaries');
  }
  
  db.exec('COMMIT');
  
  // Rebuild FTS indexes
  console.log('\nRebuilding FTS indexes...');
  try {
    db.exec("DELETE FROM messages_fts");
    const ftsMsgs = db.prepare(`
      SELECT rowid, message_id, conversation_id, content, created_at FROM messages
    `).all();
    
    const insertFtsMsg = db.prepare(`
      INSERT INTO messages_fts(rowid, message_id, conversation_id, content, created_at)
      VALUES (@rowid, @message_id, @conversation_id, @content, @created_at)
    `);
    
    for (const m of ftsMsgs) {
      try { insertFtsMsg.run(m); } catch(e) {}
    }
    console.log('  messages_fts rebuilt:', ftsMsgs.length, 'rows');
    
    db.exec("DELETE FROM summaries_fts");
    const ftsSums = db.prepare(`
      SELECT rowid, summary_id, conversation_id, content, created_at FROM summaries
    `).all();
    
    const insertFtsSum = db.prepare(`
      INSERT INTO summaries_fts(rowid, summary_id, conversation_id, content, created_at)
      VALUES (@rowid, @summary_id, @conversation_id, @content, @created_at)
    `);
    
    for (const s of ftsSums) {
      try { insertFtsSum.run(s); } catch(e) {}
    }
    console.log('  summaries_fts rebuilt:', ftsSums.length, 'rows');
  } catch (e) {
    console.log('FTS rebuild warning:', e.message);
  }
  
  // Final counts
  console.log('\n=== Merge Complete ===');
  console.log('Final conversations:', db.prepare('SELECT COUNT(*) as c FROM conversations').get().c);
  console.log('Final messages:', db.prepare('SELECT COUNT(*) as c FROM messages').get().c);
  console.log('Final message_parts:', db.prepare('SELECT COUNT(*) as c FROM message_parts').get().c);
  console.log('Final summaries:', db.prepare('SELECT COUNT(*) as c FROM summaries').get().c);
  
  const integrity = db.prepare('PRAGMA integrity_check').get();
  console.log('Integrity check:', integrity.integrity_check);
  
} catch (e) {
  console.error('Merge failed:', e.message);
  db.exec('ROLLBACK');
  throw e;
} finally {
  db.close();
}
