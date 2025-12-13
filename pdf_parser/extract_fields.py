#!/usr/bin/env python3
"""
Enhanced PDF field extraction using pdfplumber with section-by-section parsing.
Extracts: name, email, phone, linkedin, location, title, skills
Also extracts structured sections: Experience, Projects, Education, etc.
"""

import sys
import json
import re
import pdfplumber
from typing import Dict, Optional, List, Any
import phonenumbers
from email_validator import validate_email, EmailNotValidError

def extract_email(text: str) -> Optional[str]:
    """Extract email address from text"""
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
    clean_text = text.replace('(', '').replace(')', '').replace('-', '').replace('.', '').replace(' ', '')
    
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
            
            try:
                parsed = phonenumbers.parse(phone, "US")
                if phonenumbers.is_valid_number(parsed):
                    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
            except:
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
    patterns = [
        r'([A-Z][a-zA-Z\s]+),\s*([A-Z]{2})\b',
        r'([A-Z][a-zA-Z\s]+),\s*([A-Z][a-zA-Z\s]+)',
        r'([A-Z][a-zA-Z\s]+)\s+([A-Z]{2})\b',
    ]
    
    location_keywords = ['location', 'address', 'based in', 'residing in', 'from']
    
    lines = text.split('\n')
    for line in lines[:20]:
        line_lower = line.lower()
        for keyword in location_keywords:
            if keyword in line_lower:
                after_keyword = line[line_lower.find(keyword) + len(keyword):].strip()
                for pattern in patterns:
                    match = re.search(pattern, after_keyword)
                    if match:
                        return match.group(0).strip()
        
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                location = match.group(0).strip()
                if len(location) > 3 and len(location) < 50:
                    return location
    
    return None

def extract_name(text: str) -> Optional[str]:
    """Extract name from resume (usually first line or header)"""
    lines = text.split('\n')
    
    for i, line in enumerate(lines[:10]):
        line = line.strip()
        if not line or len(line) < 3:
            continue
        
        name_pattern = r'^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$'
        match = re.match(name_pattern, line)
        
        if match:
            name = match.group(1)
            if not any(word.lower() in ['email', 'phone', 'linkedin', 'location', 'address', 'resume', 'cv'] 
                     for word in name.split()):
                if i + 1 < len(lines):
                    next_line = lines[i + 1].lower()
                    if '@' in next_line or any(char.isdigit() for char in next_line):
                        return name
                if i < 3:
                    return name
    
    return None

def extract_title(text: str) -> Optional[str]:
    """Extract job title"""
    title_keywords = [
        r'(?:Senior|Junior|Lead|Principal|Staff|Senior\s+)?(?:Software|Frontend|Backend|Full\s*Stack|Full-Stack|DevOps|Data|ML|AI|Machine\s+Learning|Engineer|Developer|Architect|Manager|Analyst|Designer|Product|Marketing|Sales|HR|Finance|Operations|Consultant|Specialist)[\s\w]*',
        r'(?:Software|Frontend|Backend|Full\s*Stack|Engineer|Developer|Architect|Manager)[\s\w]+',
    ]
    
    lines = text.split('\n')
    
    for line in lines[:30]:
        line = line.strip()
        if len(line) < 5 or len(line) > 60:
            continue
        
        for pattern in title_keywords:
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                title = match.group(0).strip()
                if len(title.split()) <= 5:
                    return title
    
    return None

def extract_skills(text: str) -> List[str]:
    """Extract skills from resume"""
    common_skills = [
        'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Swift', 'Kotlin',
        'PHP', 'Ruby', 'Scala', 'Perl', 'R', 'MATLAB', 'SQL', 'HTML', 'CSS', 'SCSS', 'SASS',
        'React', 'Vue', 'Angular', 'Next.js', 'Nuxt.js', 'Svelte', 'Node.js', 'Express', 'Django',
        'Flask', 'FastAPI', 'Spring', 'Laravel', 'Symfony', 'Rails', 'ASP.NET', 'jQuery',
        'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB',
        'Oracle', 'SQL Server', 'SQLite', 'Neo4j', 'Firebase', 'Supabase',
        'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins',
        'GitLab CI', 'GitHub Actions', 'CircleCI', 'Travis CI',
        'Git', 'GraphQL', 'REST API', 'gRPC', 'WebSocket', 'Microservices', 'CI/CD',
        'Machine Learning', 'AI', 'Data Science', 'TensorFlow', 'PyTorch', 'Scikit-learn',
        'Pandas', 'NumPy', 'Jupyter', 'Tableau', 'Power BI',
        'Jest', 'Mocha', 'Cypress', 'Selenium', 'Pytest', 'JUnit',
        'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator',
    ]
    
    found_skills = []
    text_lower = text.lower()
    
    for skill in common_skills:
        pattern = r'\b' + re.escape(skill) + r'\b'
        if re.search(pattern, text, re.IGNORECASE):
            found_skills.append(skill)
    
    skills_section_pattern = r'(?:skills?|technical\s+skills?|core\s+skills?|competencies?)[:\s]*\n((?:[-•*]\s*[^\n]+\n?)+)'
    match = re.search(skills_section_pattern, text, re.IGNORECASE | re.MULTILINE)
    if match:
        skills_text = match.group(1)
        bullets = re.findall(r'[-•*]\s*([^\n]+)', skills_text)
        for bullet in bullets:
            skills_in_bullet = re.split(r'[,;|/]', bullet)
            for skill_str in skills_in_bullet:
                skill_str = skill_str.strip()
                if len(skill_str) > 2 and len(skill_str) < 50:
                    for known_skill in common_skills:
                        if known_skill.lower() in skill_str.lower() or skill_str.lower() in known_skill.lower():
                            if known_skill not in found_skills:
                                found_skills.append(known_skill)
    
    return found_skills[:30]

def extract_date_range(text: str) -> Dict[str, Optional[str]]:
    """Extract date range from text"""
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
    """Extract company/organization name from text"""
    patterns = [
        r'^([A-Z][a-zA-Z0-9\s&.,-]{2,50})(?:\s|$|,|\.)',
        r'(?:at|@|for|with)\s+([A-Z][a-zA-Z0-9\s&.,-]{2,50})(?:\s|$|,|\.)',
        r'([A-Z][a-zA-Z0-9\s&.,-]{2,50})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group|University|College|School)\b',
    ]
    
    lines = text.split('\n')
    for line in lines[:5]:
        line = line.strip()
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                company = match.group(1).strip()
                if (len(company) > 2 and len(company) < 60 and 
                    company.lower() not in ['the', 'a', 'an', 'and', 'or', 'but']):
                    return company
    
    return None

def parse_experience_section(text: str) -> List[Dict[str, Any]]:
    """Parse Experience/Work Experience section and extract multiple entries"""
    experiences = []
    
    # Find experience section - more flexible pattern
    exp_patterns = [
        r'(?:experience|work\s+experience|employment|professional\s+experience|work\s+history)[:\s]*\n(.*?)(?=\n\s*(?:education|projects?|skills?|volunteer|summary|objective|$))',
        r'(?:experience|work\s+experience)[:\s]*(.*?)(?=\n\s*(?:education|projects?|skills?|volunteer|summary|objective|$))',
    ]
    
    exp_text = None
    for pattern in exp_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            exp_text = match.group(1)
            break
    
    if not exp_text:
        return experiences
    
    # Split entries by looking for:
    # 1. Lines that start with capitalized text (likely company/school name)
    # 2. Lines with date ranges
    # 3. Empty lines followed by capitalized text
    lines = exp_text.split('\n')
    current_entry = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Check if this line starts a new entry
        # Look for: company name, date range, or title pattern
        is_new_entry = False
        if line:
            # Check for date range in line
            has_date = bool(re.search(r'\d{4}', line))
            # Check if line looks like a company/title (capitalized, reasonable length)
            looks_like_header = (len(line) > 3 and len(line) < 80 and 
                                line[0].isupper() and
                                (has_date or len(line.split()) <= 6))
            
            # If we have a current entry and hit a new header, save current entry
            if current_entry and looks_like_header and len('\n'.join(current_entry)) > 30:
                is_new_entry = True
        
        if is_new_entry:
            # Process and save current entry
            entry_text = '\n'.join(current_entry).strip()
            if len(entry_text) >= 20:
                company = extract_company(entry_text)
                dates = extract_date_range(entry_text)
                
                # Extract title
                title = None
                entry_lines = entry_text.split('\n')
                for entry_line in entry_lines[:3]:
                    entry_line = entry_line.strip()
                    if (len(entry_line) > 5 and len(entry_line) < 60 and
                        not '@' in entry_line and
                        re.search(r'(engineer|developer|manager|analyst|designer|architect|specialist|consultant|director|lead|senior|junior|software|frontend|backend)', entry_line, re.IGNORECASE)):
                        title = entry_line
                        break
                
                if company or title or dates['start_date']:
                    experiences.append({
                        "company": company,
                        "title": title,
                        "start_date": dates["start_date"],
                        "end_date": dates["end_date"],
                        "description": entry_text
                    })
            
            current_entry = []
        
        if line:
            current_entry.append(line)
        
        i += 1
    
    # Process last entry
    if current_entry:
        entry_text = '\n'.join(current_entry).strip()
        if len(entry_text) >= 20:
            company = extract_company(entry_text)
            dates = extract_date_range(entry_text)
            
            title = None
            entry_lines = entry_text.split('\n')
            for entry_line in entry_lines[:3]:
                entry_line = entry_line.strip()
                if (len(entry_line) > 5 and len(entry_line) < 60 and
                    not '@' in entry_line and
                    re.search(r'(engineer|developer|manager|analyst|designer|architect|specialist|consultant|director|lead|senior|junior|software|frontend|backend)', entry_line, re.IGNORECASE)):
                    title = entry_line
                    break
            
            if company or title or dates['start_date']:
                experiences.append({
                    "company": company,
                    "title": title,
                    "start_date": dates["start_date"],
                    "end_date": dates["end_date"],
                    "description": entry_text
                })
    
    return experiences

def parse_projects_section(text: str) -> List[Dict[str, Any]]:
    """Parse Projects section and extract multiple project entries"""
    projects = []
    
    # Find projects section
    proj_patterns = [
        r'(?:projects?|project\s+experience|personal\s+projects?|side\s+projects?)[:\s]*\n(.*?)(?=\n\s*(?:experience|education|skills?|volunteer|summary|objective|$))',
        r'(?:projects?)[:\s]*(.*?)(?=\n\s*(?:experience|education|skills?|volunteer|summary|objective|$))',
    ]
    
    proj_text = None
    for pattern in proj_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            proj_text = match.group(1)
            break
    
    if not proj_text:
        return projects
    
    # Split projects similar to experience
    lines = proj_text.split('\n')
    current_entry = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        is_new_entry = False
        if line:
            has_date = bool(re.search(r'\d{4}', line))
            looks_like_header = (len(line) > 3 and len(line) < 80 and 
                                line[0].isupper() and
                                (has_date or len(line.split()) <= 6))
            
            if current_entry and looks_like_header and len('\n'.join(current_entry)) > 20:
                is_new_entry = True
        
        if is_new_entry:
            entry_text = '\n'.join(current_entry).strip()
            if len(entry_text) >= 15:
                project_name = None
                entry_lines = entry_text.split('\n')
                first_line = entry_lines[0].strip() if entry_lines else ""
                if len(first_line) > 3 and len(first_line) < 60:
                    project_name = first_line
                
                dates = extract_date_range(entry_text)
                
                if project_name or dates['start_date']:
                    projects.append({
                        "name": project_name,
                        "start_date": dates["start_date"],
                        "end_date": dates["end_date"],
                        "description": entry_text
                    })
            
            current_entry = []
        
        if line:
            current_entry.append(line)
        
        i += 1
    
    # Process last entry
    if current_entry:
        entry_text = '\n'.join(current_entry).strip()
        if len(entry_text) >= 15:
            project_name = None
            entry_lines = entry_text.split('\n')
            first_line = entry_lines[0].strip() if entry_lines else ""
            if len(first_line) > 3 and len(first_line) < 60:
                project_name = first_line
            
            dates = extract_date_range(entry_text)
            
            if project_name or dates['start_date']:
                projects.append({
                    "name": project_name,
                    "start_date": dates["start_date"],
                    "end_date": dates["end_date"],
                    "description": entry_text
                })
    
    return projects

def parse_education_section(text: str) -> List[Dict[str, Any]]:
    """Parse Education section and extract multiple education entries"""
    educations = []
    
    # Find education section
    edu_patterns = [
        r'(?:education|academic|qualifications?|academic\s+background)[:\s]*\n(.*?)(?=\n\s*(?:experience|projects?|skills?|volunteer|summary|objective|$))',
        r'(?:education)[:\s]*(.*?)(?=\n\s*(?:experience|projects?|skills?|volunteer|summary|objective|$))',
    ]
    
    edu_text = None
    for pattern in edu_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            edu_text = match.group(1)
            break
    
    if not edu_text:
        return educations
    
    # Split education entries
    lines = edu_text.split('\n')
    current_entry = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        is_new_entry = False
        if line:
            has_date = bool(re.search(r'\d{4}', line))
            looks_like_header = (len(line) > 3 and len(line) < 80 and 
                                line[0].isupper() and
                                (has_date or len(line.split()) <= 6 or
                                 'university' in line.lower() or
                                 'college' in line.lower() or
                                 'school' in line.lower()))
            
            if current_entry and looks_like_header and len('\n'.join(current_entry)) > 20:
                is_new_entry = True
        
        if is_new_entry:
            entry_text = '\n'.join(current_entry).strip()
            if len(entry_text) >= 15:
                school = extract_company(entry_text)
                if not school:
                    entry_lines = entry_text.split('\n')
                    first_line = entry_lines[0].strip() if entry_lines else ""
                    if len(first_line) > 3 and len(first_line) < 80:
                        school = first_line
                
                degree = None
                degree_patterns = [
                    r'(Bachelor|Master|PhD|Ph\.D\.|Doctorate|Associate|Diploma|Certificate)\s+(?:of|in)?\s*([^\n,]+)',
                    r'(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|M\.?B\.?A\.?|Ph\.?D\.?)\s+(?:in|of)?\s*([^\n,]+)',
                ]
                
                for pattern in degree_patterns:
                    match = re.search(pattern, entry_text, re.IGNORECASE)
                    if match:
                        degree = match.group(0).strip()
                        break
                
                dates = extract_date_range(entry_text)
                
                if school or degree:
                    educations.append({
                        "school": school,
                        "degree": degree,
                        "start_date": dates["start_date"],
                        "end_date": dates["end_date"],
                        "description": entry_text
                    })
            
            current_entry = []
        
        if line:
            current_entry.append(line)
        
        i += 1
    
    # Process last entry
    if current_entry:
        entry_text = '\n'.join(current_entry).strip()
        if len(entry_text) >= 15:
            school = extract_company(entry_text)
            if not school:
                entry_lines = entry_text.split('\n')
                first_line = entry_lines[0].strip() if entry_lines else ""
                if len(first_line) > 3 and len(first_line) < 80:
                    school = first_line
            
            degree = None
            degree_patterns = [
                r'(Bachelor|Master|PhD|Ph\.D\.|Doctorate|Associate|Diploma|Certificate)\s+(?:of|in)?\s*([^\n,]+)',
                r'(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|M\.?B\.?A\.?|Ph\.?D\.?)\s+(?:in|of)?\s*([^\n,]+)',
            ]
            
            for pattern in degree_patterns:
                match = re.search(pattern, entry_text, re.IGNORECASE)
                if match:
                    degree = match.group(0).strip()
                    break
            
            dates = extract_date_range(entry_text)
            
            if school or degree:
                educations.append({
                    "school": school,
                    "degree": degree,
                    "start_date": dates["start_date"],
                    "end_date": dates["end_date"],
                    "description": entry_text
                })
    
    return educations

def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract text from PDF using pdfplumber"""
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
        
        # Extract basic fields
        fields = {
            "name": extract_name(text),
            "email": extract_email(text),
            "phone": extract_phone(text),
            "linkedin": extract_linkedin(text),
            "location": extract_location(text),
            "title": extract_title(text),
            "skills": extract_skills(text),
            "raw_text": text
        }
        
        # Extract structured sections
        fields["experience"] = parse_experience_section(text)
        fields["projects"] = parse_projects_section(text)
        fields["education"] = parse_education_section(text)
        
        # Output as JSON
        print(json.dumps(fields, indent=2))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
