# PDF Parser Python Service

This directory contains Python scripts for enhanced PDF parsing and text extraction.

## Setup

1. **Install Python 3.7+** (if not already installed)
   ```bash
   python3 --version
   ```

2. **Create and activate virtual environment** (Recommended)
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

   The application will automatically use the virtual environment if it exists in `pdf_parser/venv/`.
   
   If you prefer to use system Python:
   ```bash
   pip3 install -r requirements.txt
   ```

## Scripts

### `extract_fields.py`
Extracts structured fields from PDF:
- Name
- Email
- Phone
- LinkedIn
- Location
- Title
- Skills
- Raw text

**Usage:**
```bash
python3 extract_fields.py <path_to_pdf>
```

**Output:** JSON with extracted fields

### `chunk_text.py`
Chunks resume text into sections with metadata:
- Section detection (Experience, Education, Projects, etc.)
- Company extraction
- Date range extraction
- Proper chunking by sections

**Usage:**
```bash
python3 chunk_text.py "<text_content>"
```

**Output:** JSON with chunks array

## Integration

The Node.js application automatically calls these scripts when processing PDFs. Make sure:
1. Python 3.7+ is installed and accessible via `python3` or `python`
2. All dependencies are installed
3. Scripts are executable (`chmod +x *.py`)

## Troubleshooting

If Python extraction fails:
- Check Python version: `python3 --version`
- Verify dependencies: `pip3 list | grep pdfplumber`
- Check script permissions: `ls -la pdf_parser/*.py`
- The system will automatically fallback to Node.js parser

