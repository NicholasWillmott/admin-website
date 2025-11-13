# Admin Website - Server Management Dashboard

A web application for managing multiple servers hosted on a DigitalOcean droplet. Built with SolidJS (frontend) and Deno + Hono (backend).

## Architecture

```
Frontend (SolidJS) → Backend API (Deno/Hono) → SSH → DigitalOcean Droplet → wb commands
```

- **Frontend**: Displays server status and provides controls
- **Backend**: Executes SSH commands on the droplet
- **Droplet**: Hosts all servers, controlled via `wb` CLI tool

## Prerequisites

- **Node.js** (for frontend)
- **Deno** (for backend) - [Install Deno](https://deno.land/#installation)
- **SSH access** to your DigitalOcean droplet

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Admin-Website
```

### 2. Set Up SSH Keys (Required for Backend)

The backend needs SSH access to your DigitalOcean droplet to execute commands.

#### Generate SSH Key Pair

```bash
# Generate a new SSH key in PEM format (required for compatibility)
ssh-keygen -t rsa -b 4096 -m PEM -f ~/.ssh/id_rsa -N ""
```

This creates:
- `~/.ssh/id_rsa` (private key - stays on your machine)
- `~/.ssh/id_rsa.pub` (public key - goes to the droplet)

#### Copy Public Key to Droplet

```bash
# Replace 159.223.167.134 with your droplet's IP
cat ~/.ssh/id_rsa.pub | ssh root@159.223.167.134 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Enter your droplet's root password when prompted. After this, SSH will work without a password.

#### Test SSH Connection

```bash
ssh root@159.223.167.134 "echo test"
```

Should connect without asking for a password and output "test".

### 3. Configure Environment Variables

Create a `.env` file in the backend directory:

```bash
cd src/backend
nano .env
```

Add the following (adjust paths as needed):

```env
SSH_KEY_PATH=/home/yourusername/.ssh/id_rsa
DROPLET_IP=159.223.167.134
PORT=3001
```

**Important**: Replace `/home/yourusername` with your actual home directory path.

### 4. Install Dependencies

#### Frontend

```bash
npm install
```

#### Backend

```bash
cd src/backend
deno install
```

## Running the Application

You need to run both the frontend and backend simultaneously.

### Start Backend (Terminal 1)

```bash
cd src/backend
deno task dev
```

The backend will start on `http://localhost:3001`

**Backend commands:**
- `deno task dev` - Development mode with auto-reload
- `deno task start` - Production mode

### Start Frontend (Terminal 2)

```bash
npm run dev
```

The frontend will start on `http://localhost:5173`

**Frontend commands:**
- `npm run dev` - Development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Access the Application

Open your browser and navigate to:
```
http://localhost:5173
```

## Setting Up on a Different Computer

When moving to a new computer, follow these steps:

### Option 1: Generate New SSH Keys (Recommended for different users)

1. Follow the **SSH Setup** steps above (Section 2)
2. Configure `.env` with your new paths
3. Install dependencies and run

### Option 2: Copy Existing SSH Keys (Same user)

1. Copy your SSH keys from the original computer:

```bash
# On original computer
cat ~/.ssh/id_rsa
cat ~/.ssh/id_rsa.pub
```

2. On the new computer, create the keys:

```bash
mkdir -p ~/.ssh
nano ~/.ssh/id_rsa
# Paste the private key content
chmod 600 ~/.ssh/id_rsa

nano ~/.ssh/id_rsa.pub
# Paste the public key content
chmod 644 ~/.ssh/id_rsa.pub
```

3. Test SSH connection:

```bash
ssh root@159.223.167.134 "echo test"
```

4. Continue with dependency installation and running

## Available API Endpoints

The backend provides these endpoints:

- `POST /api/servers/:id/restart` - Restart a server
- `POST /api/servers/:id/update` - Update server version
  ```json
  { "version": "1.6.11" }
  ```

## Project Structure

```
Admin-Website/
├── src/
│   ├── backend/
│   │   ├── server.ts          # Hono API server
│   │   ├── ssh.ts             # SSH command executor
│   │   ├── deno.json          # Deno configuration
│   │   └── .env               # Environment variables (gitignored)
│   └── frontend/
│       ├── App.tsx            # Main SolidJS component
│       └── css/
│           └── App.css        # Styles
├── package.json               # Frontend dependencies
└── README.md                  # This file
```

## Security Notes

- ✅ SSH keys are used instead of passwords
- ✅ Commands are whitelisted to prevent injection
- ✅ CORS is configured for localhost only
- ⚠️ **Never commit** `.env` or SSH private keys to git
- ⚠️ Add authentication before deploying to production

## Troubleshooting

### "Permission denied" when SSH connecting

- Ensure your public key is in the droplet's `~/.ssh/authorized_keys`
- Check SSH key permissions: `chmod 600 ~/.ssh/id_rsa`

### Backend asks for password

- The SSH key isn't set up correctly
- Run: `cat ~/.ssh/id_rsa.pub | ssh root@159.223.167.134 "cat >> ~/.ssh/authorized_keys"`

### "Server not found" error

- Check that the server ID exists in `https://central.fastr-analytics.org/servers.json`
- Verify the server has an `id` field

### Backend won't start

- Ensure Deno is installed: `deno --version`
- Check that `.env` file exists in `src/backend/`
- Verify all environment variables are set

### CORS errors

- Make sure backend is running on port 3001
- Frontend should be on localhost:5173 or 127.0.0.1:5173

## Learn More

- [SolidJS Documentation](https://solidjs.com)
- [Deno Documentation](https://deno.land)
- [Hono Documentation](https://hono.dev)
