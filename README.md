# HealthClaim Pro (Modular Monolith)

> **Enterprise Medical Insurance & Automated Settlement Platform**  
> Dynamic Rule Engine (AST Evaluation) • Actuarial Benefit Tiering • Zero-Trust Envelope Encryption • Role-Based Access Control (RBAC)

---

## 🌐 Live Production Deployment

- **Production URL**: [https://healthclaim.pro](https://healthclaim.pro)
- **API Health Endpoint**: [https://healthclaim.pro/api/v1/health](https://healthclaim.pro/api/v1/health)
- **Architecture**: Modular Monolith on AWS EC2 (`ap-southeast-1`), Cloudflare SSL / DNS Proxied
- **Companion Microservices Repository**: [SE34-Team15/healthclaim-pro-microservices](https://github.com/SE34-Team15/healthclaim-pro-microservices) (Live at [https://ms.healthclaim.pro](https://ms.healthclaim.pro))

### 🔑 Standard RBAC Roles
| Role | Email | Permissions & Responsibilities |
| :--- | :--- | :--- |
| **System Admin** | `admin@healthclaim.pro` | Compliance rules AST management, benefit tiers configuration, system telemetry |
| **Claim Officer** | `officer@healthclaim.pro` | Medical claim assessment, rule validation overrides, approval workflows |
| **Finance Manager** | `finance@healthclaim.pro` | Payment settlement disbursement, financial analytics, ledger auditing |
| **Security Auditor**| `auditor@healthclaim.pro` | Immutable SHA-256 audit log tracking, compliance inspection |
| **Employee** | `employee@healthclaim.pro` | Claim submission, receipt file uploads, personal quota tracking |

---

## 🏗️ Monorepo Structure

```text
healthclaim-pro/
├── frontend/                  # React 19 + Vite + Tailwind CSS + Lucide Icons SPA
├── backend/                   # Modular Monolithic Domain & API Service (NestJS 11 + Prisma ORM)
│   ├── src/
│   │   ├── auth/              # JWT authentication, Argon2/Bcrypt password hashing, email verification
│   │   ├── claims/            # Finite State Machine (FSM) claim processing & approval pipeline
│   │   ├── rules/             # Abstract Syntax Tree (AST) dynamic compliance evaluation engine
│   │   ├── actuarial/         # Benefit tiers, co-pay, deductibles, quota calculations
│   │   ├── storage/           # AES-256-GCM dual-key envelope encryption with MinIO / S3 storage
│   │   ├── audit/             # Tamper-evident audit logging
│   │   └── common/mail/       # Resend API integration for email verification & notifications
├── shared/                    # Shared Zod schemas, DTO types, and validation contracts
├── pnpm-workspace.yaml        # PNPM Monorepo workspace configuration
└── README.md                  # Project overview and documentation
```

---

## 🛠️ Quick Start (Local Development)

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- PostgreSQL >= 15
- Redis >= 7

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` in both `backend` and `frontend` directories, and adjust database / Redis connection strings.

### 3. Database Migration & Seeding
```bash
cd backend
npx prisma db push
npx tsx prisma/seed.ts
```

### 4. Start Development Servers
```bash
# Start backend API (http://localhost:4000)
pnpm --filter backend start:dev

# Start frontend application (http://localhost:5173)
pnpm --filter frontend dev
```

---

## 🧪 Testing & Verification

Run automated test suites across the monorepo:
```bash
# Run backend Vitest unit & integration tests
pnpm --filter backend test

# Run type checks
pnpm -r build
```
