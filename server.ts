import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import {
  loadAutomationData,
  saveAutomationData,
} from './server/whatsappAutomation.ts';
import {
  createWhatsAppService,
  DEFAULT_SCHEDULE,
  formatPhoneDisplay,
  getD7Config,
  getMetaCloudConfig,
  getUltraMsgConfig,
  normalizeScheduleConfig,
  type AutoScheduleConfig,
  type QrGatewayAdapter,
  type QrGatewayStatus,
  type WhatsAppStorageAdapter,
} from './server/whatsappCore.ts';

const envFilePath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const AUTH_DIR = path.resolve(process.cwd(), '.whatsapp-auth');
const SCHEDULE_FILE = path.resolve(process.cwd(), '.whatsapp-schedule.json');

const sessionState: QrGatewayStatus = {
  status: 'disconnected',
  qrDataUrl: null,
  connectedPhone: null,
  connectedName: null,
  lastError: null,
  updatedAt: new Date().toISOString(),
};

let activeSocket: WASocket | null = null;
let isConnecting = false;
let manualDisconnect = false;
let consecutiveFailures = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const startBaileysConnection = async (forceResetAuth = false): Promise<void> => {
  if (isConnecting) return;
  clearReconnectTimer();

  if (forceResetAuth) {
    if (activeSocket) {
      try {
        activeSocket.end(undefined);
      } catch {
        // ignore close errors
      }
      activeSocket = null;
    }
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  if (activeSocket && sessionState.status === 'connected') {
    return;
  }

  isConnecting = true;
  manualDisconnect = false;
  sessionState.status = 'connecting';
  sessionState.lastError = null;
  sessionState.updatedAt = new Date().toISOString();

  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch {
      version = undefined;
    }

    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Desktop'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 30000,
    });

    activeSocket = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (activeSocket !== sock) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          sessionState.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: { dark: '#192A24', light: '#FFFFFF' },
          });
          sessionState.status = 'qr_ready';
          sessionState.lastError = null;
          sessionState.updatedAt = new Date().toISOString();
        } catch (qrErr) {
          sessionState.lastError =
            qrErr instanceof Error ? qrErr.message : 'Impossible de générer le QR Code.';
        }
      }

      if (connection === 'open') {
        consecutiveFailures = 0;
        sessionState.status = 'connected';
        sessionState.qrDataUrl = null;
        sessionState.connectedPhone = formatPhoneDisplay(sock.user?.id);
        sessionState.connectedName = sock.user?.name || 'WhatsApp connecté';
        sessionState.lastError = null;
        sessionState.updatedAt = new Date().toISOString();
      } else if (connection === 'close') {
        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined
        )?.output?.statusCode;
        const errMessage = (
          lastDisconnect?.error as { message?: string } | undefined
        )?.message;

        activeSocket = null;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

        if (isLoggedOut) {
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {
            // ignore
          }
          sessionState.status = 'disconnected';
          sessionState.qrDataUrl = null;
          sessionState.connectedPhone = null;
          sessionState.connectedName = null;
          sessionState.lastError =
            'Session WhatsApp expirée ou déconnectée. Cliquez sur « Connecter WhatsApp » pour scanner un nouveau QR Code.';
          sessionState.updatedAt = new Date().toISOString();
          return;
        }

        if (manualDisconnect) {
          sessionState.status = 'disconnected';
          sessionState.qrDataUrl = null;
          sessionState.connectedPhone = null;
          sessionState.connectedName = null;
          sessionState.updatedAt = new Date().toISOString();
          return;
        }

        consecutiveFailures += 1;
        if (consecutiveFailures <= 6) {
          sessionState.status = 'connecting';
          sessionState.updatedAt = new Date().toISOString();
          reconnectTimer = setTimeout(() => {
            void startBaileysConnection(false);
          }, 1200);
        } else {
          sessionState.status = 'disconnected';
          sessionState.qrDataUrl = null;
          sessionState.lastError =
            errMessage || 'Connexion WhatsApp interrompue. Veuillez relancer la connexion.';
          sessionState.updatedAt = new Date().toISOString();
        }
      }
    });
  } catch (err) {
    sessionState.status = 'disconnected';
    sessionState.qrDataUrl = null;
    sessionState.lastError =
      err instanceof Error ? err.message : 'Erreur lors de l’initialisation WhatsApp.';
    sessionState.updatedAt = new Date().toISOString();
  } finally {
    isConnecting = false;
  }
};

const disconnectBaileys = async (): Promise<void> => {
  manualDisconnect = true;
  clearReconnectTimer();
  consecutiveFailures = 0;

  if (activeSocket) {
    try {
      await activeSocket.logout();
    } catch {
      try {
        activeSocket.end(undefined);
      } catch {
        // ignore
      }
    }
    activeSocket = null;
  }

  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }

  sessionState.status = 'disconnected';
  sessionState.qrDataUrl = null;
  sessionState.connectedPhone = null;
  sessionState.connectedName = null;
  sessionState.lastError = null;
  sessionState.updatedAt = new Date().toISOString();
};

const resolveBaileysJid = async (sock: WASocket, digits: string): Promise<string> => {
  try {
    const check = await sock.onWhatsApp(digits);
    const match = Array.isArray(check) ? check[0] : undefined;
    if (match && match.exists === false) {
      throw new Error(`Le numéro +${digits} n’est pas enregistré sur WhatsApp.`);
    }
    if (match?.jid) return match.jid;
  } catch (err) {
    if (err instanceof Error && err.message.includes('pas enregistré sur WhatsApp')) {
      throw err;
    }
  }
  return `${digits}@s.whatsapp.net`;
};

const localStorageAdapter: WhatsAppStorageAdapter = {
  async loadAutomationData() {
    return loadAutomationData();
  },
  async saveAutomationData(data) {
    return saveAutomationData(data);
  },
  async loadScheduleConfig() {
    try {
      if (!fs.existsSync(SCHEDULE_FILE)) {
        return { ...DEFAULT_SCHEDULE };
      }
      const raw = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      return normalizeScheduleConfig(JSON.parse(raw) as Partial<AutoScheduleConfig>);
    } catch {
      return { ...DEFAULT_SCHEDULE };
    }
  },
  async saveScheduleConfig(config) {
    const next: AutoScheduleConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(next, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save WhatsApp schedule file:', err);
    }
    return next;
  },
};

const baileysQrGateway: QrGatewayAdapter = {
  getStatus: () => ({ ...sessionState }),
  connect: async (reset) => {
    await startBaileysConnection(reset);
  },
  disconnect: async () => {
    await disconnectBaileys();
  },
  isConnected: () => Boolean(activeSocket && sessionState.status === 'connected'),
  sendText: async (digits, text) => {
    if (!activeSocket || sessionState.status !== 'connected') {
      throw new Error('Passerelle WhatsApp non connectée.');
    }
    const jid = await resolveBaileysJid(activeSocket, digits);
    const sentInfo = await activeSocket.sendMessage(jid, { text });
    return { messageId: sentInfo?.key?.id || null };
  },
  sendDocument: async (digits, buffer, filename, caption) => {
    if (!activeSocket || sessionState.status !== 'connected') {
      throw new Error('Passerelle WhatsApp non connectée.');
    }
    const jid = await resolveBaileysJid(activeSocket, digits);
    const sentInfo = await activeSocket.sendMessage(jid, {
      document: buffer,
      mimetype: 'application/pdf',
      fileName: filename,
      ...(caption ? { caption } : {}),
    });
    return { messageId: sentInfo?.key?.id || null };
  },
};

const whatsappService = createWhatsAppService(localStorageAdapter, baileysQrGateway);

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  app.use(async (req: Request, res: Response, next) => {
    if (req.path !== '/healthz' && !req.path.startsWith('/api/whatsapp')) {
      next();
      return;
    }

    const query: Record<string, string | undefined> = {};
    for (const [key, val] of Object.entries(req.query || {})) {
      query[key] = Array.isArray(val) ? String(val[0] || '') : val !== undefined ? String(val) : undefined;
    }

    const host = req.get('host');
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const publicBaseUrl = host ? `${proto}://${host}` : '';

    try {
      const result = await whatsappService.handleRequest({
        method: req.method,
        pathname: req.path,
        query,
        body: req.body,
        publicBaseUrl,
      });

      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          res.setHeader(k, v);
        }
      }

      if (result.buffer) {
        res.status(result.status).send(result.buffer);
        return;
      }

      if (result.text !== undefined) {
        res.status(result.status).send(result.text);
        return;
      }

      res.status(result.status).json(result.json ?? {});
    } catch (err) {
      console.error('WhatsApp route error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur serveur WhatsApp.',
      });
    }
  });

  if (IS_PROD) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const viteReady = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      })
    );
    app.use(async (req: Request, res: Response, next) => {
      try {
        const vite = await viteReady;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`CAMS GOLD server listening on http://0.0.0.0:${PORT}`);
    if (
      !getMetaCloudConfig().configured &&
      !getUltraMsgConfig().configured &&
      !getD7Config().configured &&
      fs.existsSync(path.join(AUTH_DIR, 'creds.json'))
    ) {
      void startBaileysConnection(false);
    }

    if (scheduleTimer) {
      clearInterval(scheduleTimer);
    }
    const checkAutoSchedule = () => {
      void whatsappService.runSchedulerTick().catch((err) => {
        console.error('[WhatsApp Scheduler] erreur:', err);
      });
    };
    checkAutoSchedule();
    scheduleTimer = setInterval(checkAutoSchedule, 20_000);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in server:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in server:', err);
});

void startServer();
