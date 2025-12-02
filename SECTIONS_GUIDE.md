# Resume Sections Guide

This document outlines how resume sections are extracted, stored, and displayed in the system.

## Supported Sections

The system recognizes and organizes the following resume sections:

### 1. **Profile Info** (Summary/Objective/Profile)
- Stored in: `resumes` table (name, title, experience_years) + `resume_chunks` with section='Summary'
- Recognized keywords: Summary, Objective, Profile, Professional Summary, Career Objective, About, About Me
- Display: Shown in the Profile Info header section

### 2. **Contact Info**
- Stored in: `resumes` table (email, phone, location, linkedin)
- Extracted via: Field extractor service
- Display: Dedicated Contact Information section

### 3. **Work Experience**
- Stored in: `resume_chunks` with section='Experience'
- Recognized keywords: Experience, Work Experience, Employment, Professional Experience, Work History, Employment History, Career History
- Grouped by: Company name
- Fields: company, start_date, end_date, chunk_text
- Display: Timeline view grouped by company

### 4. **Projects**
- Stored in: `resume_chunks` with section='Projects'
- Recognized keywords: Projects, Project, Personal Projects, Side Projects, Project Experience, Portfolio
- Fields: company (project name), start_date, end_date, chunk_text
- Display: Grid layout with project cards

### 5. **Volunteer Work**
- Stored in: `resume_chunks` with section='Volunteer'
- Recognized keywords: Volunteer, Volunteer Work, Volunteering, Volunteer Experience, Community Service, Volunteer Activities
- Fields: company (organization), start_date, end_date, chunk_text
- Display: Highlighted section with green accent

### 6. **Education**
- Stored in: `resume_chunks` with section='Education'
- Recognized keywords: Education, Academic, Academic Background, Educational Background, Academic Qualifications, Qualifications
- Fields: company (school/university), start_date, end_date, chunk_text
- Display: Card layout with dates

### 7. **Skills**
- Stored in: `resumes` table (skills array) + `resume_chunks` with section='Skills'
- Recognized keywords: Skills, Technical Skills, Core Skills, Competencies, Technical Competencies, Proficiencies, Expertise
- Extracted via: Field extractor service (common skills list)
- Display: Tag-based display

## Database Schema

### `resumes` Table
- Stores high-level candidate information
- Fields: name, email, phone, linkedin, location, title, skills[], experience_years, resume_url, resume_text

### `resume_chunks` Table
- Stores detailed section chunks with embeddings
- Fields: resume_id, chunk_text, section, company, start_date, end_date, embedding
- The `section` field is a text field that can store any section name

## Section Detection

The chunker service (`src/lib/services/chunker.ts`) automatically:
1. Scans resume text for section headers
2. Maps variations to standardized section names
3. Groups content under the appropriate section
4. Extracts company names and dates from chunks

## Upload Process

When a resume is uploaded:
1. Text is extracted from PDF/DOCX
2. Structured fields are extracted (name, email, phone, etc.)
3. Text is chunked by sections
4. Company names and dates are extracted from each chunk
5. Embeddings are generated for each chunk
6. All data is stored in Supabase

## Display Order

The resume detail page displays sections in this order:
1. Profile Info (header)
2. Contact Information
3. Work Experience
4. Projects
5. Volunteer Work
6. Education
7. Skills

## Notes

- Sections are case-insensitive
- Multiple variations of section names are supported
- If a section is not recognized, chunks are stored with section='Other'
- The system automatically groups experience by company
- Dates are extracted in various formats (MM/YYYY, Month YYYY, YYYY, etc.)

