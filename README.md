# Break My Flow

> You ship it. We try to break it.

A judge-first hackathon evaluation tool. Paste any submission URL 
and get a structured, evidence-backed evaluation report in 60 seconds.

Built at AI Engineer Hackathon Singapore — May 9, 2026.

## Live Product

https://breakmyflow-production.up.railway.app

## What It Does

Break My Flow evaluates any hackathon submission across five dimensions:

| Section | What It Checks |
|---|---|
| First Impression | What a judge sees in 3 seconds |
| Value Proposition | Does the problem and solution land clearly |
| Demo Flow | Can a judge follow what to do without guidance |
| Technical Credibility | Does the code actually back the claims |
| Verdict | One honest closing call with next steps |

Each section scores 1-10. Overall score is the average of the four 
scored sections. The report includes a radar chart, accordion detail 
sections, security signal analysis, and .md export.

## Two Modes

| Mode | Primary User | Use Case |
|---|---|---|
| Builder Mode | Hackathon team | Self-test before judging |
| Judge Mode | Organiser or judge | Evaluate any submission |

## Security

- Rate limited to 10 requests per minute per IP
- URL validation: rejects private IPs, localhost, non-http/s protocols
- GitHub URL validation: must be a valid github.com/owner/repo URL
- 15-second timeout on screenshot capture
- 30-second timeout on Claude analysis
- Error boundary on all render failures

## Tech Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- Anthropic Claude claude-sonnet-4-5-20251001 — vision and analysis
- Screenshotone — real browser screenshot capture
- Recharts — interactive radar chart
- Railway — deployment from GitHub main branch

## Environment Variables

Create `.env.local` in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
SCREENSHOTONE_API_KEY=yourAccessKey:yourSecretKey
```

- Anthropic API key: console.anthropic.com
- Screenshotone keys: screenshotone.com/dashboard

## Running Locally

```bash
npx next dev
```

Open http://localhost:3000

## GitHub Analysis

When a GitHub repo URL is provided, Break My Flow fetches:

- README content (first 3000 chars)
- Full file tree (up to 50 files)
- package.json (dependency audit)
- Main entry point source code
- All API route files (app/api/**/route.ts)
- .env.example (if present)

And analyses for:

- Hardcoded secrets and API keys
- Boilerplate README detection
- Empty or placeholder API routes
- Missing rate limiting and input validation
- Dev dependencies in wrong section
- Stack honesty: claims vs actual packages
- TODO/FIXME comments in production code
- Missing error handling in async routes

## Export

Every report exports as a structured `.md` file. Paste it into 
Claude or ChatGPT and say: "Help me fix these issues before judging."

---

*Better now than on stage.*
