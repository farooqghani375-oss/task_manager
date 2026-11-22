# Deploying Task Manager with the AI planner (Vercel)

1. Push this whole folder to a GitHub repository and import it in Vercel (Framework preset: Other).
2. In Vercel, open Project Settings > Environment Variables and add:
   - Name: GEMINI_API_KEY
   - Value: your key from Google AI Studio
   - Environments: Production (and Preview if you want it there too)
3. Redeploy so the variable takes effect (Deployments > Redeploy).

The key stays on the server (api/plan.js). It is never sent to the browser.
Optional: add GEMINI_MODEL to choose a different Gemini model. The default is gemini-2.5-flash.

Limits:
- PDFs must be 3 MB or smaller (Vercel limits request size).
- The free Gemini quota is limited. If it runs out, the planner shows a message and the rest of the app still works.
- The planner needs an internet connection. Tasks and targets still work offline.

Every time you change app files, bump CACHE_VERSION in service-worker.js so installed copies update.
