# Python PDF Parser Setup

## Overview

The application now uses **Python with pdfplumber** for much better PDF text extraction and field parsing. This provides:

- ✅ **Better text extraction** - pdfplumber is more reliable than pdf2json
- ✅ **Enhanced field extraction** - Better regex and validation
- ✅ **Improved chunking** - Better section detection and metadata extraction
- ✅ **Automatic fallback** - Falls back to Node.js parser if Python unavailable

## Quick Setup

### 1. Install Python Dependencies

```bash
cd pdf_parser
pip3 install -r requirements.txt
```

Or use the setup script:
```bash
cd pdf_parser
./setup.sh
```

### 2. Verify Installation

```bash
python3 --version  # Should be 3.7+
pip3 list | grep pdfplumber  # Should show pdfplumber installed
```

### 3. Test Extraction

```bash
python3 pdf_parser/extract_fields.py "path/to/resume.pdf"
```

## What Gets Extracted

The Python parser extracts:

1. **Name** - From header/first lines
2. **Email** - Validated email addresses
3. **Phone** - Validated phone numbers (E.164 format)
4. **LinkedIn** - LinkedIn profile URLs
5. **Location** - City, State or City, Country
6. **Title** - Job title/position
7. **Skills** - Comprehensive skill list (30+ common skills)
8. **Raw Text** - Full extracted text for chunking

## How It Works

1. **PDF Upload** → Node.js receives file
2. **Python Extraction** → Calls `extract_fields.py` with PDF path
3. **Field Extraction** → Python uses pdfplumber + regex + validation
4. **Text Chunking** → Calls `chunk_text.py` with extracted text
5. **Database Storage** → All fields saved to Supabase

## Fallback Behavior

If Python is not available or fails:
- Automatically falls back to Node.js parser (pdf2json)
- User gets clear error message
- System continues to work (with reduced quality)

## Troubleshooting

### Python Not Found
```bash
# Install Python 3.7+
brew install python3  # macOS
# or download from python.org
```

### Dependencies Not Installing
```bash
# Try with --user flag
pip3 install --user -r requirements.txt

# Or use virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Permission Errors
```bash
chmod +x pdf_parser/*.py
```

### Test Python Scripts Manually
```bash
# Test field extraction
python3 pdf_parser/extract_fields.py "test_resume.pdf"

# Test chunking
echo "Experience\nWorked at Company\n2020-2022" | python3 pdf_parser/chunk_text.py
```

## Files

- `pdf_parser/extract_fields.py` - Field extraction script
- `pdf_parser/chunk_text.py` - Text chunking script
- `pdf_parser/requirements.txt` - Python dependencies
- `src/lib/services/python-pdf-service.ts` - Node.js integration

## Dependencies

- **pdfplumber** - Best PDF text extraction library
- **pypdf2** - Fallback PDF parser
- **phonenumbers** - Phone number validation
- **email-validator** - Email validation
- **python-dateutil** - Date parsing

## Next Steps

1. Install Python dependencies: `pip3 install -r pdf_parser/requirements.txt`
2. Test with a resume: Upload a PDF and check console logs
3. Verify fields are extracted correctly in database
4. Check chunking quality in resume detail page

