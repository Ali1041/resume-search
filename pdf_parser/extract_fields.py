#!/usr/bin/env python3
"""
Enhanced PDF field extraction using pdfplumber and multiple fallback methods.
Extracts: name, email, phone, linkedin, location, title, skills
"""

import sys
import json
import re
import pdfplumber
from typing import Dict, Optional, List
import phonenumbers
from email_validator import validate_email, EmailNotValidError

def extract_email(text: str) -> Optional[str]:
    """Extract email address from text"""
    # Common email patterns
    patterns = [
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
        r'[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            email = match.replace(' ', '').lower()
            try:
                validate_email(email)
                return email
            except EmailNotValidError:
                continue
    return None

def extract_phone(text: str) -> Optional[str]:
    """Extract phone number from text"""
    # Remove common separators for better matching
    clean_text = text.replace('(', '').replace(')', '').replace('-', '').replace('.', '').replace(' ', '')
    
    # Try to find phone numbers
    patterns = [
        r'\+?1?[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})',
        r'\+?[0-9]{1,3}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{3,4}',
        r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            if isinstance(match, tuple):
                phone = ''.join(match)
            else:
                phone = match.replace(' ', '').replace('-', '').replace('.', '').replace('(', '').replace(')', '')
            
            # Validate with phonenumbers library
            try:
                parsed = phonenumbers.parse(phone, "US")
                if phonenumbers.is_valid_number(parsed):
                    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
            except:
                # If validation fails, return cleaned number if it looks valid
                if len(phone) >= 10 and phone.isdigit():
                    return phone
    return None

def extract_linkedin(text: str) -> Optional[str]:
    """Extract LinkedIn URL"""
    patterns = [
        r'(?:https?://)?(?:www\.)?linkedin\.com/in/[\w-]+',
        r'linkedin\.com/in/[\w-]+',
        r'linkedin\.com/[\w-]+',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            url = match.group(0)
            if not url.startswith('http'):
                url = 'https://' + url
            return url
    return None

def extract_location(text: str) -> Optional[str]:
    """Extract location (city, state or city, country)"""
    # Look for patterns like "City, State" or "City, Country"
    # Common patterns
    patterns = [
        r'([A-Z][a-zA-Z\s]+),\s*([A-Z]{2})\b',  # City, State (US)
        r'([A-Z][a-zA-Z\s]+),\s*([A-Z][a-zA-Z\s]+)',  # City, State/Country
        r'([A-Z][a-zA-Z\s]+)\s+([A-Z]{2})\b',  # City State (no comma)
    ]
    
    # Also look for common location keywords
    location_keywords = ['location', 'address', 'based in', 'residing in', 'from']
    
    lines = text.split('\n')
    for line in lines[:20]:  # Check first 20 lines
        line_lower = line.lower()
        for keyword in location_keywords:
            if keyword in line_lower:
                # Extract location after keyword
                after_keyword = line[line_lower.find(keyword) + len(keyword):].strip()
                for pattern in patterns:
                    match = re.search(pattern, after_keyword)
                    if match:
                        return match.group(0).strip()
        
        # Try direct pattern matching
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                location = match.group(0).strip()
                # Filter out false positives
                if len(location) > 3 and len(location) < 50:
                    return location
    
    return None

def extract_name(text: str) -> Optional[str]:
    """Extract name from resume (usually first line or header)"""
    lines = text.split('\n')
    
    # Check first few lines for name pattern
    for i, line in enumerate(lines[:10]):
        line = line.strip()
        if not line or len(line) < 3:
            continue
        
        # Name pattern: 2-4 capitalized words, not email, not phone
        name_pattern = r'^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$'
        match = re.match(name_pattern, line)
        
        if match:
            name = match.group(1)
            # Filter out common false positives
            if not any(word.lower() in ['email', 'phone', 'linkedin', 'location', 'address', 'resume', 'cv'] 
                     for word in name.split()):
                # Check if next line has contact info (email/phone) - good indicator
                if i + 1 < len(lines):
                    next_line = lines[i + 1].lower()
                    if '@' in next_line or any(char.isdigit() for char in next_line):
                        return name
                # If it's the first significant line, likely the name
                if i < 3:
                    return name
    
    return None

def extract_title(text: str) -> Optional[str]:
    """Extract job title"""
    # Common title patterns
    title_keywords = [
        r'(?:Senior|Junior|Lead|Principal|Staff|Senior\s+)?(?:Software|Frontend|Backend|Full\s*Stack|Full-Stack|DevOps|Data|ML|AI|Machine\s+Learning|Engineer|Developer|Architect|Manager|Analyst|Designer|Product|Marketing|Sales|HR|Finance|Operations|Consultant|Specialist)[\s\w]*',
        r'(?:Software|Frontend|Backend|Full\s*Stack|Engineer|Developer|Architect|Manager)[\s\w]+',
    ]
    
    lines = text.split('\n')
    
    # Look in first 30 lines (usually header area)
    for line in lines[:30]:
        line = line.strip()
        if len(line) < 5 or len(line) > 60:
            continue
        
        for pattern in title_keywords:
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                title = match.group(0).strip()
                # Filter out if it's part of a longer sentence
                if len(title.split()) <= 5:
                    return title
    
    return None

def extract_skills(text: str) -> List[str]:
    """Extract skills from resume"""
    # Comprehensive skill list
    common_skills = [
        # Languages
        'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Swift', 'Kotlin',
        'PHP', 'Ruby', 'Scala', 'Perl', 'R', 'MATLAB', 'SQL', 'HTML', 'CSS', 'SCSS', 'SASS',
        # Frameworks & Libraries
        'React', 'Vue', 'Angular', 'Next.js', 'Nuxt.js', 'Svelte', 'Node.js', 'Express', 'Django',
        'Flask', 'FastAPI', 'Spring', 'Laravel', 'Symfony', 'Rails', 'ASP.NET', 'jQuery',
        # Databases
        'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB',
        'Oracle', 'SQL Server', 'SQLite', 'Neo4j', 'Firebase', 'Supabase',
        # Cloud & DevOps
        'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins',
        'GitLab CI', 'GitHub Actions', 'CircleCI', 'Travis CI',
        # Tools & Others
        'Git', 'GraphQL', 'REST API', 'gRPC', 'WebSocket', 'Microservices', 'CI/CD',
        'Machine Learning', 'AI', 'Data Science', 'TensorFlow', 'PyTorch', 'Scikit-learn',
        'Pandas', 'NumPy', 'Jupyter', 'Tableau', 'Power BI',
        # Testing
        'Jest', 'Mocha', 'Cypress', 'Selenium', 'Pytest', 'JUnit',
        # Design
        'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator',
    ]
    
    found_skills = []
    text_lower = text.lower()
    
    for skill in common_skills:
        # Check for exact match (case insensitive)
        pattern = r'\b' + re.escape(skill) + r'\b'
        if re.search(pattern, text, re.IGNORECASE):
            found_skills.append(skill)
    
    # Also look for skills section
    skills_section_pattern = r'(?:skills?|technical\s+skills?|core\s+skills?|competencies?)[:\s]*\n((?:[-•*]\s*[^\n]+\n?)+)'
    match = re.search(skills_section_pattern, text, re.IGNORECASE | re.MULTILINE)
    if match:
        skills_text = match.group(1)
        # Extract skills from bullet points
        bullets = re.findall(r'[-•*]\s*([^\n]+)', skills_text)
        for bullet in bullets:
            # Split by common separators
            skills_in_bullet = re.split(r'[,;|/]', bullet)
            for skill_str in skills_in_bullet:
                skill_str = skill_str.strip()
                if len(skill_str) > 2 and len(skill_str) < 50:
                    # Check if it matches a known skill
                    for known_skill in common_skills:
                        if known_skill.lower() in skill_str.lower() or skill_str.lower() in known_skill.lower():
                            if known_skill not in found_skills:
                                found_skills.append(known_skill)
    
    return found_skills[:30]  # Limit to 30 skills

def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract text from PDF using pdfplumber (best for text extraction)"""
    full_text = ""
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    full_text += page_text + "\n"
    except Exception as e:
        raise Exception(f"Failed to extract text from PDF: {str(e)}")
    
    return full_text

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "PDF path required"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        # Extract text from PDF
        text = extract_text_from_pdf(pdf_path)
        
        if not text or len(text.strip()) < 50:
            print(json.dumps({"error": "Failed to extract meaningful text from PDF"}))
            sys.exit(1)
        
        # Extract all fields
        fields = {
            "name": extract_name(text),
            "email": extract_email(text),
            "phone": extract_phone(text),
            "linkedin": extract_linkedin(text),
            "location": extract_location(text),
            "title": extract_title(text),
            "skills": extract_skills(text),
            "raw_text": text  # Include raw text for chunking
        }
        
        # Output as JSON
        print(json.dumps(fields, indent=2))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()

