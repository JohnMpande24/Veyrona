# Veyrona — Milestone 1

Veyrona Milestone 1 contains the React/Vite frontend, FastAPI backend, PostgreSQL/Neon-compatible SQLAlchemy database layer, Alembic migrations, JWT authentication, RBAC, audit logging, and seed data.

## Local development

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m app.seed
uvicorn app.main:app --reload
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The local Vite proxy sends `/api/*` to the FastAPI server.

Local seeded login:
- `admin@veyrona.local` / `ChangeMe123!`
- `operator@veyrona.local` / `ChangeMe123!`

## Neon + Vercel production

1. Create a Neon PostgreSQL database and copy its connection string.
2. Set these Vercel environment variables for Production:
   - `VEYRONA_ENV=production`
   - `VEYRONA_DATABASE_URL=<Neon connection string>`
   - `VEYRONA_SECRET_KEY=<long random secret>`
   - `VEYRONA_CORS_ORIGINS=<your Vercel URL>`
3. Install dependencies from the repository root or `backend/`.
4. From `backend/`, run the migration against Neon:

```bash
alembic upgrade head
```

5. Seed production with a non-default admin password:

```bash
VEYRONA_ENV=production \
VEYRONA_DATABASE_URL='<Neon connection string>' \
VEYRONA_SECRET_KEY='<same production secret>' \
VEYRONA_ADMIN_PASSWORD='<strong unique password>' \
python -m app.seed
```

The production seed refuses to use `ChangeMe123!`, and it does not create the schema itself. This prevents accidental schema drift and weak default credentials.

6. Deploy the repository to Vercel. `api/index.py` exposes FastAPI under `/api/*`, while the Vite build is served from `frontend/dist`.

## Production checks

- `/api/health` — application health
- `/api/health/db` — application + database connectivity
- `/api/docs` — FastAPI documentation
- Sign in at `/login` using the production admin password

## Important

Do not put Neon credentials, JWT secrets, or production passwords in Git. Use Vercel Environment Variables. Rotate the initial admin password after first login if your future UI provides password-change support.
