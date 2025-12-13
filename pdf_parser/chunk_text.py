#!/usr/bin/env python3
"""
Enhanced text chunking for resumes with better section detection
"""

import sys
import json
import re
from typing import List, Dict, Optional
from datetime import datetime

def extract_dates(text: str) -> Dict[str, Optional[str]]:
    """Extract date ranges from text"""
    # Common date patterns
    patterns = [
        r'(\w+\s+\d{4})\s*[-–]\s*(\w+\s+\d{4}|Present|Current)',
        r'(\d{4})\s*[-–]\s*(\d{4}|Present|Current)',
        r'(\w+\s+\d{4})\s+to\s+(\w+\s+\d{4}|Present|Current)',
        r'(\d{1,2}/\d{4})\s*[-–]\s*(\d{1,2}/\d{4}|Present|Current)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            start = match.group(1).strip()
            end = match.group(2).strip()
            if end.lower() in ['present', 'current']:
                end = None
            return {"start_date": start, "end_date": end}
    
    return {"start_date": None, "end_date": None}

def extract_company(text: str) -> Optional[str]:
    """Extract company name from chunk"""
    # Common patterns
    patterns = [
        r'(?:at|@|for|with)\s+([A-Z][a-zA-Z0-9\s&.,-]{2,40})',
        r'^([A-Z][a-zA-Z0-9\s&.,-]{2,40})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group)?$',
        r'([A-Z][a-zA-Z0-9\s&.,-]{2,40})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group)\b',
    ]
    
    lines = text.split('\n')
    for line in lines[:3]:  # Check first few lines
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                company = match.group(1).strip()
                # Filter out false positives
                if (len(company) > 2 and len(company) < 50 and 
                    company.lower() not in ['university', 'college', 'school', 'the']):
                    return company
    
    return None

def chunk_resume_text(text: str) -> List[Dict]:
    """Chunk resume text into sections with metadata"""
    chunks = []
    lines = text.split('\n')
    
    # Section keywords mapping
    section_keywords = {
        'experience': 'Experience',
        'work experience': 'Experience',
        'employment': 'Experience',
        'professional experience': 'Experience',
        'work history': 'Experience',
        'education': 'Education',
        'academic': 'Education',
        'qualifications': 'Education',
        'projects': 'Projects',
        'project': 'Projects',
        'volunteer': 'Volunteer',
        'volunteer work': 'Volunteer',
        'volunteering': 'Volunteer',
        'skills': 'Skills',
        'technical skills': 'Skills',
        'core skills': 'Skills',
        'summary': 'Summary',
        'objective': 'Summary',
        'profile': 'Summary',
        'professional summary': 'Summary',
    }
    
    current_section = None
    current_chunk = []
    min_chunk_length = 50
    max_chunk_length = 500
    
    def flush_chunk():
        if current_chunk:
            chunk_text = '\n'.join(current_chunk).strip()
            if len(chunk_text) >= min_chunk_length:
                dates = extract_dates(chunk_text)
                company = extract_company(chunk_text)
                
                chunks.append({
                    "chunk_text": chunk_text,
                    "section": current_section,
                    "company": company,
                    "start_date": dates["start_date"],
                    "end_date": dates["end_date"]
                })
    
    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            if current_chunk and len('\n'.join(current_chunk)) > min_chunk_length:
                flush_chunk()
                current_chunk = []
            continue
        
        line_lower = line_stripped.lower()
        
        # Check if this is a section header
        is_section_header = False
        for keyword, section_name in section_keywords.items():
            if (line_lower == keyword or 
                line_lower.startswith(keyword + ':') or
                line_lower.startswith(keyword + ' ') or
                line_lower == keyword.upper()):
                flush_chunk()
                current_section = section_name
                current_chunk = []
                is_section_header = True
                break
        
        if not is_section_header:
            # Check if we should flush current chunk
            current_text = '\n'.join(current_chunk)
            is_bullet = re.match(r'^[•\-\*\+]\s', line_stripped) or re.match(r'^\d+\.\s', line_stripped)
            
            if ((is_bullet and len(current_text) > max_chunk_length / 2) or 
                len(current_text) > max_chunk_length):
                flush_chunk()
                current_chunk = []
            
            current_chunk.append(line_stripped)
    
    # Flush remaining chunk
    flush_chunk()
    
    # If no chunks created, use sliding window
    if not chunks:
        return create_sliding_window_chunks(text, min_chunk_length, max_chunk_length)
    
    return chunks

def create_sliding_window_chunks(text: str, min_length: int, max_length: int) -> List[Dict]:
    """Create chunks using sliding window approach"""
    chunks = []
    overlap = 50
    start = 0
    
    while start < len(text):
        end = start + max_length
        
        # Try to end at sentence boundary
        if end < len(text):
            last_period = text.rfind('.', start, end)
            last_newline = text.rfind('\n', start, end)
            boundary = max(last_period, last_newline)
            
            if boundary > start + min_length:
                end = boundary + 1
        
        chunk_text = text[start:end].strip()
        if len(chunk_text) >= min_length:
            chunks.append({
                "chunk_text": chunk_text,
                "section": None,
                "company": None,
                "start_date": None,
                "end_date": None
            })
        
        start = end - overlap
        if start >= len(text):
            break
    
    return chunks

def main():
    # Read text from stdin (piped input) or file path argument
    if len(sys.argv) >= 2:
        # If file path provided, read from file
        try:
            with open(sys.argv[1], 'r', encoding='utf-8') as f:
                text = f.read()
        except:
            # If file read fails, treat as direct text (fallback)
            text = sys.argv[1]
    else:
        # Read from stdin
        text = sys.stdin.read()
    
    if not text or len(text.strip()) < 10:
        print(json.dumps({"error": "Text required"}))
        sys.exit(1)
    
    try:
        chunks = chunk_resume_text(text)
        print(json.dumps({"chunks": chunks}, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()

