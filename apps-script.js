// ═══════════════════════════════════════════════════════
//  TIENDITA DNSE · CEPLAN
//  Google Apps Script — Sheets + Vision Proxy
// ═══════════════════════════════════════════════════════

/**
 * 🛠 FUNCIÓN PARA AUTORIZAR TODO
 * Selecciona esta función arriba y dale a "Ejecutar" para que
 * Google te pida los permisos de Gemini y Google Drive.
 */
function PROBAR_PERMISOS() {
  Logger.log("Probando permisos de Drive...");
  DriveApp.getRootFolder().getName(); // Fuerza permiso de Drive
  Logger.log("Probando permisos de Web...");
  UrlFetchApp.fetch("https://www.google.com"); // Fuerza permiso de Internet
  Logger.log("¡PERMISOS CONCEDIDOS CON ÉXITO! 🎉");
}

const SHEET_ID = '1B17IQSxZ6KiIFzIfj6ECSq60J9pAnZDZb19XftT_AaA';
const SHEET_NAME = 'Hoja 1';
// 🌟 NUEVO: Usamos Google Gemini 1.5 Flash para mejor reconocimiento (¡Más rápido y en español!)
// Obtén tu API key gratis en: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = 'AIzaSyCc2xUwEGi0nRs8sp-hngvXjWQ0vyx8GrE';

// ── CORS helper — Simple JSON utility ──
function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET — used for: health check + READ log ──
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'read') {
    return readSheet();
  }

  return jsonOk({ ok: true, status: 'Tiendita DNSE activo' });
}

// ── POST — used for: write log + vision ──
function doPost(e) {
  try {
    const body = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(body);

    if (data.action === 'vision') {
      return handleVision(data.imageBase64, data.mimeType || 'image/jpeg');
    }

    return writeRow(data);

  } catch (err) {
    return jsonOk({ ok: false, error: err.message });
  }
}

// ─────────────────────────────────────────────
//  READ — returns all rows as JSON array
// ─────────────────────────────────────────────
function readSheet() {
  try {
    const sheet = SpreadsheetApp
      .openById(SHEET_ID)
      .getSheetByName(SHEET_NAME);

    const last = sheet.getLastRow();
    if (last < 2) return jsonOk({ ok: true, rows: [] });

    // rows 2..last (skip header row 1)
    // Lee hasta la columna 9 (donde vivirá la URL de la foto)
    const values = sheet.getRange(2, 1, last - 1, 9).getValues();

    const rows = values
      .filter(r => r[0] !== '')   // skip empty rows
      .map(r => ({
        date: String(r[0] || ''),
        time: String(r[1] || ''),
        name: String(r[2] || ''),
        action: actionKey(String(r[3] || '')),
        item: String(r[4] || ''),
        qty: Number(r[5]) || 0,
        nota: String(r[6] || ''),
        ts: String(r[7] || ''),
        foto: String(r[8] || '')
      }));

    return jsonOk({ ok: true, rows: rows });

  } catch (err) {
    return jsonOk({ ok: false, error: err.message, rows: [] });
  }
}

// converts "Cogió"→"take", "Repuso"→"give", "Alerta"→"alert"
function actionKey(label) {
  if (label === 'Cogió') return 'take';
  if (label === 'Repuso') return 'give';
  if (label === 'Alerta') return 'alert';
  return label; // already a key
}

// ─────────────────────────────────────────────
//  WRITE — appends one row
// ─────────────────────────────────────────────
function writeRow(data) {
  const sheet = SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName(SHEET_NAME);

  // create header if sheet is empty
  if (sheet.getLastRow() === 0) {
    const hdr = sheet.appendRow(
      ['Fecha', 'Hora', 'Persona', 'Acción', 'Producto', 'Cantidad', 'Nota', 'Timestamp', 'Foto (Enlace)']
    );
    sheet.getRange(1, 1, 1, 9)
      .setFontWeight('bold')
      .setBackground('#7C3AED')
      .setFontColor('white');
  }

  const actionLabel =
    data.action === 'take' ? 'Cogió' :
      data.action === 'give' ? 'Repuso' :
        data.action === 'alert' ? 'Alerta' : data.action;

  let photoUrl = '';
  if (data.photoBase64) {
    try {
      // Create or find folder
      const folders = DriveApp.getFoldersByName('Tiendita_Fotos');
      let folder = folders.hasNext() ? folders.next() : null;
      if (!folder) {
        folder = DriveApp.createFolder('Tiendita_Fotos');
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }

      const parts = data.photoBase64.split(',');
      const decoded = Utilities.base64Decode(parts[1] || parts[0]);
      const blob = Utilities.newBlob(decoded, 'image/jpeg', 'snack_' + new Date().getTime() + '.jpg');
      const file = folder.createFile(blob);
      photoUrl = file.getUrl();
    } catch (e) {
      Logger.log('Drive Error: ' + e.message);
      photoUrl = 'Error Drive: ' + e.message;
    }
  }

  sheet.appendRow([
    data.date || '',
    data.time || '',
    data.name || '',
    actionLabel,
    data.item || '',
    data.qty || '',
    data.nota || '',
    new Date().toISOString(),
    photoUrl
  ]);

  return jsonOk({ ok: true });
}

// ─────────────────────────────────────────────
//  VISION — Gemini 1.5 Flash
// ─────────────────────────────────────────────
function handleVision(imageBase64, mimeType) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'TU_API_KEY_AQUI') {
    return jsonOk({ ok: true, name: '', source: 'manual', error: 'Falta configurar GEMINI_API_KEY' });
  }

  try {
    const payload = {
      contents: [{
        parts: [
          {
            text: 'Eres un asistente de una tiendita de snacks de oficina en Perú. ' +
              'Identifica el producto de comida o snack en la imagen con la mayor precisión posible. ' +
              'Responde ÚNICAMENTE con el nombre corto en español (máximo 4 palabras). ' +
              'Ejemplos: "Chocolate Sublime", "Galletas Oreo", "Maní salado", ' +
              '"Papitas Lays", "Alfajor", "Gomitas ositos", "Barra cereal". ' +
              'Sin puntos, sin explicaciones. Solo el nombre del snack.'
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 25
      }
    };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + GEMINI_API_KEY;
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    const body = resp.getContentText();
    Logger.log('Gemini code: ' + code);

    if (code === 200) {
      const result = JSON.parse(body);
      let name = '';
      if (result.candidates && result.candidates[0].content.parts.length > 0) {
        name = result.candidates[0].content.parts[0].text;
      }
      name = name.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\.$/, '').trim();

      if (name && name.length > 1) {
        return jsonOk({ ok: true, name: name, source: 'gemini' });
      }
    } else {
      Logger.log('ERROR GEMINI (' + code + '): ' + body);
      // Enviamos el error al frontend para que el usuario sepa qué pasa
      return jsonOk({ ok: false, name: '', source: 'manual', error: 'Error API Gemini: ' + code });
    }
  } catch (e) {
    Logger.log('EXCEPCIÓN GEMINI: ' + e.message);
    return jsonOk({ ok: false, name: '', source: 'manual', error: 'Excepción: ' + e.message });
  }

  // Fallback si falla Gemini
  return jsonOk({ ok: true, name: '', source: 'manual' });
}
