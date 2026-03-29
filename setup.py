"""
Yua Memory System - Setup Script

This setup.py provides backward compatibility for older pip versions.
For modern workflows, pyproject.toml is preferred.
"""

from setuptools import setup, find_packages

if __name__ == "__main__":
    setup(
        name="yua-memory",
        version="1.0.0",
        description="Emotional Memory Management System for AI Agents",
        long_description=open("README.md", "r", encoding="utf-8").read(),
        long_description_content_type="text/markdown",
        author="Bryan & Yua",
        author_email="bryan@yua.system",
        url="https://github.com/yua-system/yua-memory",
        packages=find_packages(include=["yua_memory", "yua_memory.*"]),
        python_requires=">=3.8",
        install_requires=[
            "numpy>=1.21.0",
            "scikit-learn>=1.0.0",
            "pyyaml>=6.0",
        ],
        extras_require={
            "dev": [
                "pytest>=7.0.0",
                "pytest-cov>=4.0.0",
                "black>=23.0.0",
                "isort>=5.12.0",
                "mypy>=1.0.0",
            ],
            "telegram": [
                "requests>=2.28.0",
            ],
        },
        classifiers=[
            "Development Status :: 4 - Beta",
            "Intended Audience :: Developers",
            "License :: OSI Approved :: MIT License",
            "Programming Language :: Python :: 3",
            "Programming Language :: Python :: 3.8",
            "Programming Language :: Python :: 3.9",
            "Programming Language :: Python :: 3.10",
            "Programming Language :: Python :: 3.11",
            "Programming Language :: Python :: 3.12",
            "Topic :: Scientific/Engineering :: Artificial Intelligence",
        ],
        keywords="ai memory emotional-intelligence retrieval rag yua",
        project_urls={
            "Bug Reports": "https://github.com/yua-system/yua-memory/issues",
            "Source": "https://github.com/yua-system/yua-memory",
        },
    )
