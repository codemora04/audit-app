import { supabase } from "./supabase.js";

/* ===================== SESSION CHECK ===================== */
const { data: sessionWrap } = await supabase.auth.getSession();
if (!sessionWrap?.session) window.location.href = "login.html";

/* ===================== LOAD DICT FROM SUPABASE ===================== */
async function loadDict(name) {
  const { data, error } = await supabase
    .from("app_data")
    .select("data")
    .eq("name", name)
    .single();

  if (error) {
    console.error("Cannot load", name, error.message);
    alert("Erreur: impossible de charger les données depuis Supabase.");
    return null;
  }
  return data?.data ?? null;
}

const DICT_REVEY = await loadDict("DICT_REVEY");
console.log("DICT_REVEY:", DICT_REVEY);
if (!DICT_REVEY) throw new Error("DICT_REVEY not loaded");

/* ===================== DOM ===================== */
const atelierSelect = document.getElementById("atelier");

const auditContainer = document.getElementById("audit-container");
const auditSelect = document.getElementById("audit");

const zoneContainer = document.getElementById("zone-container");
const zoneSelect = document.getElementById("zone");

const rubriqueContainer = document.getElementById("rubrique-container");
const rubriquesList = document.getElementById("rubriques-list");

const downloadBtn = document.getElementById("downloadPdf");
const downloadScoreBtn = document.getElementById("downloadScoreBtn");

/* Sécurité: si un élément manque */
if (!atelierSelect || !auditSelect || !zoneSelect || !rubriqueContainer || !rubriquesList) {
  console.error("Erreur HTML: un ou plusieurs éléments sont introuvables (ids incorrects).");
}

/* ===================== HELPERS ===================== */
function resetSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">--Choisir--</option>`;
}

function hideAllBelowAtelier() {
  auditContainer?.classList.add("hidden");
  zoneContainer?.classList.add("hidden");
  rubriqueContainer?.classList.add("hidden");
  downloadBtn?.classList.add("hidden");
  downloadScoreBtn?.classList.add("hidden");

  resetSelect(auditSelect);
  resetSelect(zoneSelect);
  if (rubriquesList) rubriquesList.innerHTML = "";
}

/* ===================== ROW COMPLETION + COLOR ===================== */
function isRowComplete(tr) {
  const status = tr.querySelector("select");
  const comment = tr.querySelector('input[type="text"]');
  const file = tr.querySelector('input[type="file"]');

  const statusOk = status && status.value !== "";
  const commentOk = comment && comment.value.trim() !== "";
  const fileOk = file && file.files && file.files.length > 0;

  return statusOk && commentOk && fileOk;
}

function updateRowColor(tr) {
  if (!tr) return;
  if (isRowComplete(tr)) tr.classList.add("row-complete");
  else tr.classList.remove("row-complete");
}

/* ===================== POPULATE ATELIERS ===================== */
resetSelect(atelierSelect);
Object.keys(DICT_REVEY || {}).forEach((atelier) => {
  const opt = document.createElement("option");
  opt.value = atelier;
  opt.textContent = atelier;
  atelierSelect.appendChild(opt);
});

atelierSelect.addEventListener("change", () => {
  hideAllBelowAtelier();

  const atelier = atelierSelect.value;
  if (!atelier) return;

  const auditsObj = DICT_REVEY?.[atelier] || {};
  const audits = Object.keys(auditsObj);

  resetSelect(auditSelect);
  audits.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    auditSelect.appendChild(opt);
  });

  auditContainer?.classList.remove("hidden");
});

/* 2) Audit -> Zones */
auditSelect.addEventListener("change", () => {
  zoneContainer?.classList.add("hidden");
  rubriqueContainer?.classList.add("hidden");
  downloadBtn?.classList.add("hidden");
  downloadScoreBtn?.classList.add("hidden");

  resetSelect(zoneSelect);
  if (rubriquesList) rubriquesList.innerHTML = "";

  const atelier = atelierSelect.value;
  const audit = auditSelect.value;
  if (!atelier || !audit) return;

  const zonesObj = DICT_REVEY?.[atelier]?.[audit] || {};
  const zones = Object.keys(zonesObj);

  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    zoneSelect.appendChild(opt);
  });

  zoneContainer?.classList.remove("hidden");
});

/* 3) Zone -> Rubriques (DIRECT) */
zoneSelect.addEventListener("change", () => {
  rubriqueContainer?.classList.add("hidden");
  downloadBtn?.classList.add("hidden");
  downloadScoreBtn?.classList.add("hidden");
  if (rubriquesList) rubriquesList.innerHTML = "";

  const atelier = atelierSelect.value;
  const audit = auditSelect.value;
  const zone = zoneSelect.value;
  if (!atelier || !audit || !zone) return;

  const zoneData = DICT_REVEY?.[atelier]?.[audit]?.[zone];
  if (!zoneData) return;

  // Si c'est un tableau ["R1","R2"], on le transforme en objet
  let rubriquesObj = zoneData;
  if (Array.isArray(zoneData)) {
    rubriquesObj = Object.fromEntries(zoneData.map((r) => [r, []]));
  }

  showRubriques(rubriquesObj);
});

/* ===================== STATUS HELPERS ===================== */
function isSafetyAuditSelected() {
  // adapte le texte EXACT à ton option dans Supabase si besoin
  return auditSelect?.value === "Safety - Chasse aux anomalies";
}

function statusValueToLabel(value) {
  if (isSafetyAuditSelected()) {
    if (value === "oui") return "Oui";
    if (value === "non") return "Non";
    if (value === "na") return "Non applicable";
    return "";
  } else {
    if (value === "1") return "Good";
    if (value === "2") return "Acceptable";
    if (value === "3") return "Unsatisfactory";
    return "";
  }
}

/* ===================== SHOW RUBRIQUES ===================== */
function showRubriques(rubriquesObj) {
  if (!rubriquesList) return;
  rubriquesList.innerHTML = "";

  Object.entries(rubriquesObj || {}).forEach(([rubrique, questions], index) => {
    // Header (accordion)
    const header = document.createElement("div");
    header.className = "rubrique-header";
    header.innerHTML = `&#9654; ${rubrique}`;

    // Wrapper
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "rubrique-table-wrapper hidden";

    // Table
    const table = document.createElement("table");
    table.className = "questions-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Question</th>
          <th>Status</th>
          <th>Commentaire</th>
          <th>Image</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    (questions || []).forEach((q, qIndex) => {
      const tr = document.createElement("tr");

      const safety = isSafetyAuditSelected();

      let statusOptions = `<option value="">--</option>`;
      if (safety) {
        statusOptions += `
          <option value="oui">Oui</option>
          <option value="non">Non</option>
          <option value="na">Non applicable</option>
        `;
      } else {
        statusOptions += `
          <option value="1">Good</option>
          <option value="2">Acceptable</option>
          <option value="3">Unsatisfactory</option>
        `;
      }

      tr.innerHTML = `
        <td>${q}</td>
        <td>
          <select name="status_${index}_${qIndex}">
            ${statusOptions}
          </select>
        </td>
        <td>
          <input type="text" name="comment_${index}_${qIndex}" placeholder="Commentaire..." />
        </td>
        <td>
          <input type="file" name="image_${index}_${qIndex}" accept="image/*" capture="environment" />
        </td>
      `;

      tbody.appendChild(tr);

      // Update color when inputs change
      const statusEl = tr.querySelector("select");
      const commentEl = tr.querySelector('input[type="text"]');
      const fileEl = tr.querySelector('input[type="file"]');

      [statusEl, commentEl, fileEl].forEach((el) => {
        if (!el) return;
        el.addEventListener("change", () => updateRowColor(tr));
        el.addEventListener("input", () => updateRowColor(tr));
      });

      updateRowColor(tr);
    });

    tableWrapper.appendChild(table);

    // Accordion toggle
    header.addEventListener("click", () => {
      tableWrapper.classList.toggle("hidden");
      header.innerHTML =
        (tableWrapper.classList.contains("hidden") ? "&#9654;" : "&#9660;") + " " + rubrique;
    });

    rubriquesList.appendChild(header);
    rubriquesList.appendChild(tableWrapper);
  });

  rubriqueContainer?.classList.remove("hidden");
  downloadBtn?.classList.remove("hidden");
  downloadScoreBtn?.classList.remove("hidden");
}

/* ===================== IMAGE COMPRESS ===================== */
async function readImageCompressed(file, maxW = 900, quality = 0.7) {
  if (!file || !file.type.startsWith("image/")) return "";

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Image illisible"));
    im.src = dataUrl;
  });

  const ratio = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

/* ===================== PDF DOWNLOAD (FULL REPORT) ===================== */
downloadBtn?.addEventListener("click", async () => {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    const logo = new Image();
    logo.src = "logo2.png";

    const generatePDF = async () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString("fr-FR");
      const timeStr = now.toLocaleTimeString("fr-FR");

      const atelier = atelierSelect?.value || "";
      const audit = auditSelect?.value || "";
      const zone = zoneSelect?.value || "";

      doc.setFontSize(12);
      doc.text(`Date de téléchargement : ${dateStr} à ${timeStr}`, 14, 15);

      doc.setFontSize(16);
      doc.setFont(undefined, "bold");
      doc.text(`${atelier} — ${audit}`, 14, 25);

      doc.setFontSize(12);
      doc.setFont(undefined, "normal");
      doc.text(`Zone : ${zone}`, 14, 33);

      let y = 42;

      const children = Array.from(rubriquesList.children);

      for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (!el.classList.contains("rubrique-header")) continue;

        const rubriqueTitle = el.textContent.replace("▼", "").replace("▶", "").trim();

        const wrapper = children[i + 1];
        const table = wrapper?.querySelector("table.questions-table");
        if (!table) continue;

        const rows = [];
        const imagesMap = new Map();

        const trs = Array.from(table.querySelectorAll("tbody tr"));

        for (let r = 0; r < trs.length; r++) {
          const tr = trs[r];

          const question = tr.children[0]?.textContent?.trim() || "";
          const statusVal = tr.querySelector("select")?.value || "";
          const statusLabel = statusValueToLabel(statusVal);
          const comment = tr.querySelector('input[type="text"]')?.value?.trim() || "";

          const fileInput = tr.querySelector('input[type="file"]');
          const file = fileInput?.files?.[0];

          if (file) {
            const imgData = await readImageCompressed(file, 900, 0.7);
            if (imgData) imagesMap.set(r, imgData);
          }

          rows.push([question, statusLabel, comment, ""]);
        }

        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(12);
        doc.text(`Rubrique: ${rubriqueTitle}`, 14, y);
        y += 6;

        doc.autoTable({
          startY: y,
          head: [["Question", "Status", "Commentaire", "Image"]],
          body: rows,

          headStyles: {
            fillColor: [76, 175, 80],
            textColor: 255,
            fontStyle: "bold",
            halign: "center",
          },

          styles: {
            fontSize: 9,
            cellPadding: 2,
            valign: "middle",
            lineWidth: 0.2,
            lineColor: [0, 0, 0],
          },

          bodyStyles: { minCellHeight: 30 },

          columnStyles: {
            0: { cellWidth: 70 },
            1: { cellWidth: 25, halign: "center" },
            2: { cellWidth: 55 },
            3: { cellWidth: 30 },
          },

          didParseCell: function (data) {
            if (data.section === "body" && data.column.index === 3) {
              data.cell.text = [""];
            }
          },

          didDrawCell: function (data) {
            if (data.section === "body" && data.column.index === 3) {
              const rowIndex = data.row.index;
              const imgData = imagesMap.get(rowIndex);
              if (!imgData) return;

              const x = data.cell.x + 1.5;
              const yImg = data.cell.y + 1.5;
              const w = data.cell.width - 3;
              const h = data.cell.height - 3;

              doc.addImage(imgData, "JPEG", x, yImg, w, h);
            }
          },
        });

        y = doc.lastAutoTable.finalY + 10;
      }

      doc.save("rapport_audit.pdf");
    };

    logo.onload = async function () {
      const logoWidth = 30;
      const logoHeight = 15;
      const xLogo = pageWidth - logoWidth - 10;
      const yLogo = 10;

      doc.addImage(logo, "PNG", xLogo, yLogo, logoWidth, logoHeight);
      await generatePDF();
    };

    logo.onerror = async function () {
      console.warn("Logo introuvable ou non chargeable:", logo.src);
      await generatePDF();
    };
  } catch (e) {
    console.error("Erreur PDF:", e);
    alert("Erreur PDF: " + e.message);
  }
});

/* ===================== SCORE COMPUTE ===================== */
function computeScores() {
  const results = [];
  const headers = rubriquesList.querySelectorAll(".rubrique-header");

  headers.forEach((header, index) => {
    const rubriqueName = header.textContent.replace("▼", "").replace("▶", "").trim();

    const wrapper = header.nextElementSibling;
    const rows = wrapper?.querySelectorAll("tbody tr") || [];

    const totalQuestions = rows.length;
    let goodCount = 0;

    rows.forEach((tr) => {
      const status = tr.querySelector("select")?.value;

      // Good = "1" OU Oui = "oui"
      if (status === "1" || status === "oui") goodCount++;
    });

    let score = 0;
    if (totalQuestions > 0) score = (goodCount / totalQuestions) * 100;
    score = Math.round(score * 10) / 10;

    results.push({
      rubrique: rubriqueName || `S${index + 1}`,
      score: score + " %",
    });
  });

  return results;
}

/* ===================== PDF DOWNLOAD (SCORES TABLE) ===================== */
downloadScoreBtn?.addEventListener("click", () => {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const scores = computeScores();

    const audit = auditSelect?.value || "";
    const zone = zoneSelect?.value || "";

    const username = localStorage.getItem("username") || "";
    const date = new Date().toLocaleDateString("fr-FR");

    const rows = [
      ["Société", "REVEY"],
      ["Département / Audit", audit],
      ["Zone", zone],
      ["Date d'audit", date],
      ["Auditeur", username],
    ];

    let total = 0;
    const count = scores.length;

    scores.forEach((s) => {
      rows.push([s.rubrique, s.score]);
      total += parseFloat(s.score);
    });

    let totalFinal = 0;
    if (count > 0) totalFinal = total / count;

    totalFinal = Math.round(totalFinal * 10) / 10;
    rows.push(["Total", totalFinal + " %"]);

    doc.setFontSize(14);
    doc.text("Score Audit", 14, 15);

    doc.autoTable({
      startY: 25,
      body: rows,
      theme: "grid",

      styles: {
        fontSize: 10,
        cellPadding: 3,
        lineWidth: 0.2,
        lineColor: [180, 180, 180],
        valign: "middle",
        textColor: [25, 27, 35],
      },

      columnStyles: {
        0: { cellWidth: 90, fontStyle: "bold" },
        1: { cellWidth: 90, halign: "center" },
      },

      didParseCell: function (data) {
        // colonne gauche en vert clair
        if (data.section === "body" && data.column.index === 0) {
          data.cell.styles.fillColor = [198, 224, 180];
        }
        // Total en gris
        if (data.section === "body" && data.row.index === rows.length - 1) {
          data.cell.styles.fillColor = [220, 220, 220];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    doc.save("score_audit_tableau.pdf");
  } catch (e) {
    console.error("Erreur Score PDF:", e);
    alert("Erreur Score PDF: " + e.message);
  }
});