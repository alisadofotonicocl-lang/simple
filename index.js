// Bot simple de WhatsApp con QR (Baileys) + mini web de estado
import 'dotenv/config'
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys'
import qrcodeTerminal from 'qrcode-terminal'
import express from 'express'
import fs from 'fs'
import path from 'path'
import QR from 'qrcode'

const app = express()
const PORT = process.env.PORT || 3000

let lastQR = null
let connected = false
const statusFile = path.join(process.cwd(), 'status.json')

function saveStatus(obj) {
  try {
    fs.writeFileSync(statusFile, JSON.stringify(obj, null, 2))
  } catch {}
}

// Mini sitio de estado y QR
app.get('/', (req, res) => {
  const html = `
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>WhatsApp Bot - Estado</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f0f12;color:#fff;margin:0}
        .card{background:#14141a;border:1px solid #2a2a32;border-radius:16px;padding:28px;max-width:560px;width:92%;box-shadow:0 10px 30px rgba(0,0,0,.4)}
        h1{margin:0 0 8px;font-size:22px}
        .ok{color:#9be48c}.warn{color:#ffd86b}.err{color:#ff7b7b}
        .muted{opacity:.8}
        img{width:320px;height:320px;object-fit:contain;background:#fff;border-radius:12px;padding:8px;border:1px solid #2a2a32}
        .row{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
        code{background:#0e0e12;border:1px solid #2a2a32;border-radius:8px;padding:2px 6px}
        .foot{margin-top:12px;font-size:12px;opacity:.7}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Estado del Bot</h1>
        <p>${connected ? '✅ <span class="ok">Conectado</span>' : (lastQR ? '🟡 <span class="warn">Escanea el QR con WhatsApp Business</span>' : '⏳ <span class="warn">Iniciando…</span>')}</p>
        ${
          connected 
            ? '<p class="muted">Tu WhatsApp está vinculado. Puedes cerrar esta página.</p>'
            : lastQR 
              ? '<div class="row"><img src="/qr.svg" alt="QR de vinculación" /><div><p>Abrir <b>WhatsApp Business</b> → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>, y escanear.</p></div></div>'
              : '<p class="muted">Esperando a que el sistema reciba el primer QR…</p>'
        }
        <div class="foot">Puerto: <code>${PORT}</code> • Carpeta de sesión: <code>/auth</code></div>
      </div>
    </body>
    </html>
  `
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(html)
})

app.get('/qr.svg', async (req, res) => {
  if (!lastQR || connected) {
    res.status(404).send('No hay QR disponible.')
    return
  }
  try {
    const svg = await QR.toString(lastQR, { type: 'svg' })
    res.setHeader('content-type', 'image/svg+xml')
    res.end(svg)
  } catch (e) {
    res.status(500).send('Error generando QR.')
  }
})

app.listen(PORT, () => {
  console.log(`🌐 Panel de estado en http://localhost:${PORT}`)
})

// ---- Baileys (WhatsApp Web) ----
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Chrome')
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      lastQR = qr
      connected = false
      console.log('🔳 Escanea este QR (o abre el panel web):')
      qrcodeTerminal.generate(qr, { small: true })
    }

    if (connection === 'open') {
      connected = true
      lastQR = null
      console.log('✅ Conectado a WhatsApp.')
      saveStatus({ status: 'connected', connectedAt: new Date().toISOString() })
    } else if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('❌ Conexión cerrada.', shouldReconnect ? 'Reintentando…' : 'Sesión cerrada definitivamente.')
      if (shouldReconnect) {
        setTimeout(() => start(), 1500)
      } else {
        saveStatus({ status: 'closed', closedAt: new Date().toISOString() })
      }
    }
  })
}

start().catch((e) => {
  console.error('Error al iniciar:', e)
  process.exit(1)
})
