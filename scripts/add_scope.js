import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:\\Users\\bbfcc\\.openclaw\\workspace\\config\\memory_vector_index.db');

console.log('=== Adding scope column to memory_blocks ===\n');

try {
  // Add scope column with default value 'Shared'
  db.exec("ALTER TABLE memory_blocks ADD COLUMN scope TEXT DEFAULT 'Shared'");
  console.log('✅ scope column added');
  
  // Update existing rows to have 'Shared' scope
  const update = db.prepare("UPDATE memory_blocks SET scope = 'Shared' WHERE scope IS NULL");
  update.run();
  console.log('✅ Existing rows updated to scope=Shared');
  
  // Verify
  const schema = db.prepare("PRAGMA table_info(memory_blocks)").all();
  console.log('\nNew schema:');
  schema.forEach(c => console.log(`  ${c.name} (${c.type})`));
  
  // Show scope distribution
  const counts = db.prepare("SELECT scope, COUNT(*) as c FROM memory_blocks GROUP BY scope").all();
  console.log('\nScope distribution:');
  counts.forEach(r => console.log(`  ${r.scope}: ${r.c}`));
  
} catch (e) {
  console.log('Error:', e.message);
}

db.close();
console.log('\n=== Done ===');
