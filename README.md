# Mohammed Shariq Shariff – Portfolio

Live site: https://shariqsh.github.io/portfolio/

## Overview
A clean, high-performance personal portfolio showcasing experience, projects, skills, and certifications in AI engineering and LLM/agentic systems. It is a static site built with semantic HTML5, modern vanilla CSS, and JavaScript—optimized for smooth navigation, accessibility, responsive design, and quick deployment on GitHub Pages.

## Features
- Responsive layout with fixed navbar and smooth section navigation
- Interactive project showcases highlighting agentic AI, LangGraph, and RAG-based systems
- Experience timeline and detailed technical skills breakdown
- Interactive contact cards with one-click email copy and direct links
- Downloadable resume and external profile links (GitHub, LinkedIn)
- Prefers-reduced-motion friendly animations, accessible focus states, and zero framework bloat

## Tech Stack
- **HTML5**: Semantic sections, SEO, and Open Graph metadata
- **CSS3**: Custom design tokens, responsive layouts, glassmorphism, and micro-interactions
- **JavaScript (Vanilla)**: DOM APIs, Intersection Observer, and clipboard handling
- **Typography**: Google Fonts (Inter)

## Project Structure
```
/portfolio
├── index.html          # Main page markup & SEO tags
├── style.css           # Styling system & design tokens
├── app.js              # Core application logic
├── interaction.js      # User interactions & feedback handling
├── motion.js           # Scroll triggers & motion effects
├── assets/             # Icons and resume document
│   ├── Mohammed-Shariq-Shariff-Resume.pdf
│   └── ...
├── tests/              # Component and interaction tests
└── README.md
```

## Getting Started
- **Option A**: Open `index.html` directly in any modern browser.
- **Option B** (recommended for local development):
```bash
# from the portfolio directory
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

## Deployment (GitHub Pages)
1. Push changes to GitHub:
   ```bash
   git push origin main
   ```
2. Go to **Settings** → **Pages** in your GitHub repository.
3. Under **Build and deployment**, set source to **Deploy from a branch**, choose `main` branch and `/(root)`, then click **Save**.
4. Your site will be published at: `https://shariqsh.github.io/portfolio/`

## Contact
- **Email**: shariqshariff003@gmail.com
- **LinkedIn**: https://www.linkedin.com/in/shariqshariff
- **GitHub**: https://github.com/shAriqsh
- **Location**: Bengaluru, India

## License
Copyright (c) 2026 Mohammed Shariq Shariff. All rights reserved.
