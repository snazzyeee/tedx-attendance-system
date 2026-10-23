import { MEMBERS } from "../src/config/members";
import { google } from "googleapis";

async function run() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // 1. Fetch current data
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Attendance'!A1:ZZ",
  });
  const currentRows = res.data.values || [];
  
  // 2. Map existing rows by name
  let header = ["Member Name", "Domain"];
  const existingMap = new Map();
  if (currentRows.length > 0) {
    header = currentRows[0];
    for (let i = 1; i < currentRows.length; i++) {
      const row = currentRows[i];
      if (row[0]) {
        existingMap.set(row[0].trim().toLowerCase(), row);
      }
    }
  }

  // 3. Build new grid matching exactly MEMBERS
  const newGrid = [header];
  for (const m of MEMBERS) {
    const existing = existingMap.get(m.name.toLowerCase().trim());
    if (existing) {
      // Ensure the domain is correct just in case
      existing[1] = m.domain;
      
      // Pad existing row to match header width
      while (existing.length < header.length) {
        existing.push("");
      }
      newGrid.push(existing);
    } else {
      // Missing member
      const newRow = [m.name, m.domain];
      while (newRow.length < header.length) {
        newRow.push("");
      }
      newGrid.push(newRow);
    }
  }

  // Clear existing sheet contents to ensure no leftover rows at bottom
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'Attendance'!A1:ZZ",
  });

  // Write new grid
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Attendance'!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: newGrid },
  });

  console.log(`Successfully seeded sheet with ${MEMBERS.length} members!`);
}

run().catch(console.error);
