# Contributing to Yua Memory System

Thank you for your interest in contributing to Yua Memory System! This document provides guidelines and instructions for contributing.

## 🎯 What We're Looking For

Yua Memory System is an emotional-aware memory management system for AI companions. We welcome contributions in:

- **Bug fixes** — Found a bug? Let us know or submit a PR!
- **Feature improvements** — Enhanced ERS scoring, better retrieval algorithms
- **Documentation** — Examples, tutorials, translations
- **Performance optimization** — Query speed, memory usage
- **Test coverage** — More unit/integration tests

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- Git
- A GitHub account

### Setup Development Environment

```bash
# Fork the repository on GitHub

# Clone your fork
git clone https://github.com/YOUR_USERNAME/yua-memory.git
cd yua-memory

# Create a virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS
venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install pytest pytest-cov ruff mypy
```

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=yua_memory --cov-report=html

# Run type checking
mypy yua_memory/
```

## 🔧 Making Changes

### Branch Naming

- `fix/` — Bug fixes
- `feature/` — New features
- `docs/` — Documentation only
- `refactor/` — Code refactoring

### Code Style

We use **Ruff** for linting and formatting:

```bash
# Format code
ruff format .

# Lint code
ruff check .

# Auto-fix issues
ruff check --fix .
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(retriever): add ERS boost for high-arousal states
fix(circuit_breaker): handle JSON serialization for ConflictType
docs(readme): add bilingual quick start guide
test(aging): add SQL-based TTL filtering tests
```

### Pull Request Process

1. **Fork** the repository
2. **Create a branch** from `master`: `git checkout -b feature/my-feature`
3. **Make your changes** — follow the code style guidelines
4. **Add tests** — if adding new functionality
5. **Run tests** — ensure all pass: `pytest`
6. **Commit** with a clear message
7. **Push** to your fork
8. **Open a Pull Request** — describe your changes clearly

## 📋 Pull Request Template

```markdown
## Description
Brief description of the changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactor
- [ ] Test coverage

## Testing
How did you test your changes?

## Checklist
- [ ] Code follows the style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated if needed
- [ ] Tests added/updated
- [ ] All tests pass locally
```

## 🐛 Reporting Bugs

When reporting bugs, please include:

- **Python version**
- **Operating system**
- **Expected behavior vs actual behavior**
- **Minimal reproduction steps**
- **Error messages / stack traces**

## 💬 Questions?

- **Issues** — For bug reports and feature requests
- **Discussions** — For questions and general discussion

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

_Giving AI a Heartbeat_ ❤️
