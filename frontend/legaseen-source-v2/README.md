# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm ci
npm run dev
```

### Windows quick start

Double-click `start-windows.cmd`. It removes any incomplete dependency installation,
installs the exact versions in `package-lock.json`, and starts the local website.

If you prefer PowerShell, run these commands from the project folder:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm cache verify
npm ci
npm run dev
```

Use Node.js 22 LTS. Do not copy an old `node_modules` folder into this project.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
