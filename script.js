let isProcessing = false;
let currentJobId = null;

function generateJobId() {
  return Date.now().toString() + "-" + Math.random().toString(36).substr(2, 9);
}

function setLoading(state) {
  isProcessing = state;
  document.getElementById("submitBtn").disabled = state;
  document.getElementById("clearBtn").disabled = !state;
}

function updateProgress(current, total) {
  const progressBar = document.getElementById("progressBar");
  if (!progressBar) return;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = percent + "%";
  progressBar.innerText = `${percent}%`;
}

function createSiteCard(result) {
  if (result.error) {
    return `
      <div class="card error">
        <h3>${result.site}</h3>
        <p style="color:red;">Error: ${result.error}</p>
      </div>
    `;
  }
  return `
    <div class="card">
      <h3>${result.site}</h3>
      <p><strong>Emails:</strong> ${result.emails.join(", ") || "None"}</p>
      <p><strong>Contact/About Links:</strong> ${result.links.join("<br>") || "None"}</p>
      <small>Total Links: ${result.stats.totalLinks}, Contact Links: ${result.stats.contactLinks}</small>
    </div>
  `;
}

document.getElementById("websiteForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  if (isProcessing) return;

  const textareaValue = document.getElementById("textarea").value.trim();
  const domains = textareaValue.split("\n").map(d => d.trim()).filter(Boolean);

  if (domains.length === 0) {
    alert("Please write valid domain names");
    return;
  }

  if (domains.length > 5) {
    alert("You can only enter up to 5 domains at once.");
    return;
  }

  currentJobId = generateJobId();
  setLoading(true);
  updateProgress(0, domains.length);
  document.getElementById("result").innerHTML = "";

  try {
    const response = await fetch("https://email-lookup.onrender.com/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domains, jobId: currentJobId }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let processedCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          const result = JSON.parse(line);
          document.getElementById("result").innerHTML += createSiteCard(result);
          processedCount++;
          updateProgress(processedCount, domains.length);
        }
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
});


document.getElementById("clearBtn").addEventListener("click", async () => {
  if (isProcessing && currentJobId) {
    await fetch("https://email-lookup.onrender.com/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: currentJobId }),
    });
  }
  document.getElementById("textarea").value = "";
  document.getElementById("result").innerHTML = "";
  localStorage.removeItem("emailScraperResults");
  updateProgress(0, 0);
  isProcessing = false;
});
