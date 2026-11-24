'use strict';
/**
 * Liest und schreibt die Tabs des Mock-Sheets als CSV-Dateien:
 *   <dir>/kuerkarten.csv         Werte des Tabs "Kürkarten"
 *   <dir>/kuerkarten.notes.csv   Zellnotizen (Stempel-Details)
 *   <dir>/zugaenge.csv           Tab "Zugänge"
 * Datumswerte stehen als yyyy-mm-dd (bzw. yyyy-mm-ddTHH:mm) in der Datei.
 */
const fs = require('fs');
const path = require('path');

const FILES = { 'Kürkarten': 'kuerkarten', 'Zugänge': 'zugaenge', 'Übersicht': 'uebersicht' };
const pad = n => String(n).padStart(2, '0');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toCsv(grid) {
  // Leere Zeilen/Spalten am Ende abschneiden, damit die Dateien gut lesbar bleiben
  let rows = grid.map(r => (r || []).map(cellOut));
  while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
  const width = rows.reduce((w, r) => {
    let last = r.length; while (last > 0 && r[last - 1] === '') last--;
    return Math.max(w, last);
  }, 0);
  rows = rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return rows.map(r => r.map(q).join(',')).join('\n') + (rows.length ? '\n' : '');
}

function cellOut(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const date = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    return v.getHours() === 12 && v.getMinutes() === 0 ? date : `${date}T${pad(v.getHours())}:${pad(v.getMinutes())}`;
  }
  return String(v);
}

function q(v) {
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function readIfExists(file) {
  return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : null;
}

// Tabs aus einem Verzeichnis laden: [{ name, values, notes }]
function loadSheets(dir) {
  const sheets = [];
  for (const [name, base] of Object.entries(FILES)) {
    const values = readIfExists(path.join(dir, base + '.csv'));
    if (!values) continue;
    const notes = readIfExists(path.join(dir, base + '.notes.csv')) || [];
    sheets.push({ name, values, notes });
  }
  return sheets;
}

// Aktuellen Stand des Mock-Sheets zurück in CSV-Dateien schreiben
function saveSheets(dir, ss) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, base] of Object.entries(FILES)) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) continue;
    fs.writeFileSync(path.join(dir, base + '.csv'), toCsv(sheet.values));
    const hasNotes = sheet.notes.some(r => (r || []).some(Boolean));
    const notesFile = path.join(dir, base + '.notes.csv');
    if (hasNotes) fs.writeFileSync(notesFile, toCsv(sheet.notes));
    else if (fs.existsSync(notesFile)) fs.unlinkSync(notesFile);
  }
}

module.exports = { parseCsv, toCsv, loadSheets, saveSheets };
