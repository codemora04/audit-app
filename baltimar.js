import { supabase } from "./supabase.js";

/* ===================== SESSION CHECK ===================== */
const { data } = await supabase.auth.getSession();
if (!data.session) window.location.href = "login.html";

const userId = data.session.user.id;

/* ===================== LOAD DICT FROM SUPABASE ===================== */
async function loadDict(name) {
  const { data, error } = await supabase
    .from("app_data")
    .select("data")
    .eq("name", name)
    .order("data", { ascending: true })
    .single();

  if (error) {
    console.error("Cannot load", name, error.message);
    alert("Erreur: impossible de charger les données depuis Supabase.");
    return null;
  }
  return data.data;
}

const DICT_BALTIMAR = await loadDict("DICT_BALTIMAR");
if (!DICT_BALTIMAR) throw new Error("DICT_BALTIMAR not loaded");

/* ===================== DOM ===================== */
const auditSelect = document.getElementById("audit");

const zoneContainer = document.getElementById("zone-container");
const zoneSelect = document.getElementById("zone");

const souszoneContainer = document.getElementById("souszone-container");
const souszoneSelect = document.getElementById("souszone");

const rubriqueContainer = document.getElementById("rubrique-container");
const rubriquesList = document.getElementById("rubriques-list");

const downloadBtn = document.getElementById("downloadPdf");
const downloadScoreBtn = document.getElementById("downloadPdfScore");

const username = localStorage.getItem("username") || "";

/* ===================== DB STATE ===================== */
let currentSessionId = null;

/* ===================== HELPERS UI ===================== */
function resetSelect(selectEl) {
  selectEl.innerHTML = `<option value="">--Choisir--</option>`;
}

function hideAllBelowAudit() {
  zoneContainer.classList.add("hidden");
  souszoneContainer.classList.add("hidden");
  rubriqueContainer.classList.add("hidden");
  if (downloadBtn) downloadBtn.classList.add("hidden");

  resetSelect(zoneSelect);
  resetSelect(souszoneSelect);
  rubriquesList.innerHTML = "";
}

/* ===================== ROW COMPLETION ===================== */
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
  if (isRowComplete(tr)) tr.classList.add("row-complete");
  else tr.classList.remove("row-complete");
}

/* ===================== STATUS OPTIONS ===================== */
function getStatusOptions(auditName) {
  if (auditName === "Audit Safety-Chasse au anomalies") {
    return `
      <option value="">--</option>
      <option value="oui">Oui</option>
      <option value="non">Non</option>
      <option value="na">Non applicable</option>
    `;
  }

  return `
    <option value="">--</option>
    <option value="1">Good</option>
    <option value="2">Acceptable</option>
    <option value="3">Unsatisfactory</option>
  `;
}

/* ===================== DB HELPERS ===================== */
function safeUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createAuditSession(audit) {
  const { data: session, error } = await supabase
    .from("audit_sessions")
    .insert({
      user_id: userId,
      audit: audit,
      zone: null,
      souszone: null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return session.id;
}

async function updateAuditSession(patch) {
  if (!currentSessionId) return;
  await supabase.from("audit_sessions").update(patch).eq("id", currentSessionId);
}

async function uploadImageToStorage(file) {
  if (!file) return "";

  // bucket name must exist in Supabase Storage: audit-images
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const filePath = `image_url/${safeUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("audit-images")
    .upload(filePath, file, { upsert: true });

  if (upErr) throw upErr;

  const { data } = supabase.storage.from("audit-images").getPublicUrl(filePath);
  return data.publicUrl || "";
}

async function saveAnswer({ rubriqueTitle, question, statusLabel, comment, file }) {
  if (!currentSessionId) return;

  let image_url = null;
  try {
    if (file) {
      const url = await uploadImageToStorage(file);
      image_url = url || null;
    }
  } catch (e) {
    console.error("Upload image error:", e);
    alert("Erreur upload image: " + (e?.message || JSON.stringify(e)));
  }


  const { error } = await supabase
    .from("audit_answers")
    .upsert(
      {
        session_id: currentSessionId,
        rubrique: rubriqueTitle,
        question: question,
        status: statusLabel,
        comment: comment,
        image_url: image_url,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,rubrique,question" }
    );

  if (error) console.error("Save answer error:", error.message);
}

/* ===================== INIT AUDITS SELECT ===================== */
Object.keys(DICT_BALTIMAR).forEach((audit) => {
  const opt = document.createElement("option");
  opt.value = audit;
  opt.textContent = audit;
  auditSelect.appendChild(opt);
});

/* ===================== EVENTS: AUDIT / ZONE / SOUSZONE ===================== */
auditSelect.addEventListener("change", async () => {
  hideAllBelowAudit();

  const audit = auditSelect.value;
  if (!audit) return;

  // ✅ create new session
  try {
    currentSessionId = await createAuditSession(audit);
  } catch (e) {
    console.error("Cannot create session FULL error:", e);
    alert("Erreur Supabase: " + (e?.message || JSON.stringify(e)));
    return;
  }

  const zonesObj = DICT_BALTIMAR[audit] || {};
  const zones = Object.keys(zonesObj);

  resetSelect(zoneSelect);
  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    zoneSelect.appendChild(opt);
  });

  zoneContainer.classList.remove("hidden");
});

zoneSelect.addEventListener("change", async () => {
  souszoneContainer.classList.add("hidden");
  rubriqueContainer.classList.add("hidden");
  if (downloadBtn) downloadBtn.classList.add("hidden");

  resetSelect(souszoneSelect);
  rubriquesList.innerHTML = "";

  const audit = auditSelect.value;
  const zone = zoneSelect.value;
  if (!audit || !zone) return;

  // ✅ save zone in session
  await updateAuditSession({ zone, souszone: null });

  const zoneData = DICT_BALTIMAR[audit]?.[zone];
  if (!zoneData) return;

  // ✅ CAS GWP (déjà ton comportement)
  const isGWP = audit === "Audit GWP-Agence" || audit === "Audit GWP-Usines";
  if (isGWP) {
    showRubriques(zoneData);
    return;
  }

  // ✅ NOUVEAU : CAS "pas de sous-zone"
  const values = typeof zoneData === "object" && zoneData !== null ? Object.values(zoneData) : [];

  const zoneIsDirectQuestions = Array.isArray(zoneData);
  const zoneIsDirectRubriques = values.length > 0 && values.every((v) => Array.isArray(v));

  if (zoneIsDirectQuestions || zoneIsDirectRubriques) {
    showRubriques(zoneData);
    return;
  }

  // ✅ CAS NORMAL : il y a des sous-zones
  const souszones = Object.keys(zoneData);

  resetSelect(souszoneSelect);
  souszones.forEach((sz) => {
    const opt = document.createElement("option");
    opt.value = sz;
    opt.textContent = sz;
    souszoneSelect.appendChild(opt);
  });

  souszoneContainer.classList.remove("hidden");
});

souszoneSelect.addEventListener("change", async () => {
  rubriqueContainer.classList.add("hidden");
  if (downloadBtn) downloadBtn.classList.add("hidden");
  rubriquesList.innerHTML = "";

  const audit = auditSelect.value;
  const zone = zoneSelect.value;
  const souszone = souszoneSelect.value;
  if (!audit || !zone || !souszone) return;

  // ✅ save souszone in session
  await updateAuditSession({ souszone });

  const rubriquesObj = DICT_BALTIMAR[audit]?.[zone]?.[souszone];
  if (!rubriquesObj) return;

  showRubriques(rubriquesObj);
});

/* ===================== SHOW RUBRIQUES ===================== */
function showRubriques(rubriquesObj) {
  rubriquesList.innerHTML = "";

  // ✅ CAS 1 : directement un tableau de questions (pas de rubrique)
  if (Array.isArray(rubriquesObj)) {
    const header = document.createElement("div");
    header.className = "rubrique-header";
    header.innerHTML = "Questions";

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "rubrique-table-wrapper";

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

    rubriquesObj.forEach((q, qIndex) => {
      const tr = document.createElement("tr");
      const auditName = auditSelect.value;

      tr.innerHTML = `
        <td>${q}</td>

        <td>
          <select name="status_0_${qIndex}">
            ${getStatusOptions(auditName)}
          </select>
        </td>

        <td>
          <input type="text" name="comment_0_${qIndex}" placeholder="Commentaire..." />
        </td>

        <td>
          <input type="file" name="image_0_${qIndex}" accept="image/*" />
        </td>
      `;

      tbody.appendChild(tr);

      const statusEl = tr.querySelector("select");
      const commentEl = tr.querySelector('input[type="text"]');
      const fileEl = tr.querySelector('input[type="file"]');

      const rubriqueTitle = "Questions";
      const questionText = q;

      async function onRowChange() {
        const statusLabel = statusEl?.selectedOptions?.[0]?.textContent?.trim() || "";
        const comment = commentEl?.value?.trim() || "";
        const file = fileEl?.files?.[0] || null;

        await saveAnswer({
          rubriqueTitle,
          question: questionText,
          statusLabel,
          comment,
          file,
        });

        updateRowColor(tr);
      }

      statusEl.addEventListener("change", onRowChange);
      commentEl.addEventListener("input", onRowChange);
      fileEl.addEventListener("change", onRowChange);

      updateRowColor(tr);
    });

    tableWrapper.appendChild(table);

    header.addEventListener("click", () => {
      tableWrapper.classList.toggle("hidden");
    });

    rubriquesList.appendChild(header);
    rubriquesList.appendChild(tableWrapper);
  }

  // ✅ CAS 2 : il y a des rubriques
  else {
    Object.entries(rubriquesObj).forEach(([rubrique, questions], index) => {
      const header = document.createElement("div");
      header.className = "rubrique-header";
      header.innerHTML = `&#9654; ${rubrique}`;

      const tableWrapper = document.createElement("div");
      tableWrapper.className = "rubrique-table-wrapper";

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
        const auditName = auditSelect.value;

        tr.innerHTML = `
          <td>${q}</td>

          <td>
            <select name="status_${index}_${qIndex}">
              ${getStatusOptions(auditName)}
            </select>
          </td>

          <td>
            <input type="text" name="comment_${index}_${qIndex}" placeholder="Commentaire..." />
          </td>

          <td>
            <input type="file" name="image_${index}_${qIndex}" accept="image/*" />
          </td>
        `;

        tbody.appendChild(tr);

        const statusEl = tr.querySelector("select");
        const commentEl = tr.querySelector('input[type="text"]');
        const fileEl = tr.querySelector('input[type="file"]');

        const rubriqueTitle = rubrique;
        const questionText = q;

        async function onRowChange() {
          const statusLabel = statusEl?.selectedOptions?.[0]?.textContent?.trim() || "";
          const comment = commentEl?.value?.trim() || "";
          const file = fileEl?.files?.[0] || null;

          await saveAnswer({
            rubriqueTitle,
            question: questionText,
            statusLabel,
            comment,
            file,
          });

          updateRowColor(tr);
        }

        statusEl.addEventListener("change", onRowChange);
        commentEl.addEventListener("input", onRowChange);
        fileEl.addEventListener("change", onRowChange);

        updateRowColor(tr);
      });

      tableWrapper.appendChild(table);

      header.addEventListener("click", () => {
        tableWrapper.classList.toggle("hidden");
        header.innerHTML =
          (tableWrapper.classList.contains("hidden") ? "&#9654;" : "&#9660;") +
          " " +
          rubrique;
      });

      tableWrapper.classList.add("hidden");

      rubriquesList.appendChild(header);
      rubriquesList.appendChild(tableWrapper);
    });
  }

  rubriqueContainer.classList.remove("hidden");
  if (downloadBtn) downloadBtn.classList.remove("hidden");
}

/* ===================== PDF: IMAGE COMPRESS ===================== */
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

    const audit = auditSelect?.value || "";
    const zone = zoneSelect?.value || "";
    const souszone = souszoneSelect?.value || "";

    const now = new Date();
    const dateStr = now.toLocaleDateString("fr-FR");
    const timeStr = now.toLocaleTimeString("fr-FR");

    const pageWidth = doc.internal.pageSize.getWidth();
    const logo = new Image();
    logo.src = "logo1.png";

    const drawHeader = () => {
      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.text(`Date de téléchargement : ${dateStr} à ${timeStr}`, 14, 15);

      doc.setFontSize(14);
      doc.setFont(undefined, "bold");
      doc.text(`${audit}`, 14, 24);

      doc.setFontSize(11);
      doc.setFont(undefined, "normal");
      doc.text(`Zone : ${zone}`, 14, 31);
      if (souszone) doc.text(`Sous-zone : ${souszone}`, 14, 38);
    };

    const generatePDF = async () => {
      drawHeader();
      let y = souszone ? 46 : 38;

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

          const statusSelect = tr.querySelector("select");
          const statusLabel = statusSelect?.selectedOptions?.[0]?.textContent?.trim() || "";

          const comment = tr.querySelector('input[type="text"]')?.value?.trim() || "";

          const fileInput = tr.querySelector('input[type="file"]');
          const file = fileInput?.files?.[0];

          if (file) {
            const imgData = await readImageCompressed(file, 900, 0.7);
            if (imgData) imagesMap.set(r, imgData);
          }

          rows.push([question, statusLabel, comment, ""]);
        }

        if (y > 260) {
          doc.addPage();
          drawHeader();
          y = souszone ? 46 : 38;
        }

        doc.setFontSize(12);
        doc.setFont(undefined, "bold");
        doc.text(`Rubrique: ${rubriqueTitle}`, 14, y);
        doc.setFont(undefined, "normal");
        y += 6;

        if (!rows || rows.length === 0) continue;

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
            2: { cellWidth: 60 },
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

    logo.onload = async () => {
      const logoWidth = 30;
      const logoHeight = 15;
      const xLogo = pageWidth - logoWidth - 10;
      const yLogo = 8;

      doc.addImage(logo, "PNG", xLogo, yLogo, logoWidth, logoHeight);
      await generatePDF();
    };

    logo.onerror = async () => {
      console.warn("Logo introuvable:", logo.src);
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
    const rows = wrapper.querySelectorAll("tbody tr");

    const totalQuestions = rows.length;
    let goodCount = 0;

    rows.forEach((tr) => {
      const status = tr.querySelector("select")?.value;

      // ✅ "Good" (value="1") OU "Oui" (value="oui")
      if (status === "1" || status === "oui") {
        goodCount++;
      }
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
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const scores = computeScores();

  const audit = auditSelect.value || "";
  const zone = zoneSelect.value || "";
  const souszone = souszoneSelect.value || "";

  const username = localStorage.getItem("username") || "";
  const date = new Date().toLocaleDateString("fr-FR");

  const rows = [
    ["Sociétés", "BALTIMAR"],
    ["Departements", audit],
    ["Sous-zones", souszone],
    ["Zones", zone],
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

    headStyles: {
      fillColor: [60, 60, 60],
      textColor: [25, 27, 35],
      fontStyle: "bold",
      halign: "center",
    },

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
      if (data.section === "body" && data.column.index === 0) {
        data.cell.styles.fillColor = [136, 187, 0];
      }
      if (data.section === "body" && data.row.index === rows.length - 1) {
        data.cell.styles.fillColor = [220, 220, 220];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save("score_audit_tableau.pdf");
});