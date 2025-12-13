#!/bin/bash

echo "Setting up PDF Parser Python Environment..."

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    echo "✓ Found Python 3: $(python3 --version)"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    echo "✓ Found Python: $(python --version)"
else
    echo "✗ Python not found. Please install Python 3.7+"
    exit 1
fi

# Check pip
if command -v pip3 &> /dev/null; then
    PIP_CMD="pip3"
elif command -v pip &> /dev/null; then
    PIP_CMD="pip"
else
    echo "✗ pip not found. Please install pip"
    exit 1
fi

# Install dependencies
echo "Installing Python dependencies..."
$PIP_CMD install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✓ Dependencies installed successfully"
else
    echo "✗ Failed to install dependencies"
    exit 1
fi

# Make scripts executable
chmod +x extract_fields.py chunk_text.py

echo "✓ Setup complete!"
echo ""
echo "To test the setup, run:"
echo "  python3 extract_fields.py <path_to_pdf>"

