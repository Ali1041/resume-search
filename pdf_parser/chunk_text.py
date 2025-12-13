#!/usr/bin/env python3
"""
Enhanced text chunking for resumes with better section detection and multiple items per section
"""

import sys
import json
import re
from typing import List, Dict, Optional

def extract_dates(text: str) -> Dict[str, Optional[str]]:
    """Extract date ranges from text"""
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
    patterns = [
        r'(?:at|@|for|with)\s+([A-Z][a-zA-Z0-9\s&.,-]{2,40})',
        r'^([A-Z][a-zA-Z0-9\s&.,-]{2,40})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group)?$',
        r'([A-Z][a-zA-Z0-9\s&.,-]{2,40})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group)\b',
        r'^([A-Z][a-zA-Z0-9\s&.,-]{2,40})(?:\s|$)/m',
    ]
    
    lines = text.split('\n')
    for line in lines[:3]:
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                company = match.group(1).strip()
                if (len(company) > 2 and len(company) < 50 and 
                    company.lower() not in ['university', 'college', 'school', 'the']):
                    return company
    
    return None

def chunk_resume_text(text: str) -> List[Dict]:
    """Chunk resume text into sections with metadata, handling multiple items per section"""
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
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        if not line:
            if current_chunk and len('\n'.join(current_chunk)) > min_chunk_length:
                flush_chunk()
                current_chunk = []
            i += 1
            continue
        
        line_lower = line.lower()
        
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
            # Check if this might be a new entry within a section
            # Look for patterns that indicate a new item:
            # - Line starting with capitalized text (likely company/school/project name)
            # - Line with date range
            # - Line after empty line that starts with capital letter
            
            is_new_entry = False
            if current_section and current_chunk:
                # Check if previous line was empty or short, and this line looks like a header
                if i > 0:
                    prev_line = lines[i-1].strip()
                    if (not prev_line or len(prev_line) < 10):
                        # Check if current line looks like a title/header
                        if (len(line) > 3 and len(line) < 80 and 
                            line[0].isupper() and
                            not line.lower().startswith(('•', '-', '*', '1.', '2.', '3.'))):
                            # Check if it has a date or looks like a company name
                            has_date = bool(re.search(r'\d{4}', line))
                            looks_like_header = (has_date or 
                                               len(line.split()) <= 5 or
                                               any(word in line.lower() for word in ['inc', 'llc', 'corp', 'ltd', 'university', 'college']))
                            
                            if looks_like_header:
                                is_new_entry = True
            
            if is_new_entry:
                flush_chunk()
                current_chunk = []
            
            # Check if we should flush current chunk due to size
            current_text = '\n'.join(current_chunk)
            is_bullet = re.match(r'^[•\-\*\+]\s', line) or re.match(r'^\d+\.\s', line)
            
            if ((is_bullet and len(current_text) > max_chunk_length / 2) or 
                len(current_text) > max_chunk_length):
                flush_chunk()
                current_chunk = []
            
            current_chunk.append(line)
        
        i += 1
    
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
    if len(sys.argv) >= 2:
        try:
            with open(sys.argv[1], 'r', encoding='utf-8') as f:
                text = f.read()
        except:
            text = sys.argv[1]
    else:
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
