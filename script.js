let isProcessing = false;

function saveResultsToLocalStorage(results) {
  localStorage.setItem("emailScraperResults", JSON.stringify(results));
}

function loadResultsFromLocalStorage() {
  const results = localStorage.getItem("emailScraperResults");
  if (results) {
    try {
      const parsedResults = JSON.parse(results);
      displayResults(parsedResults);
    } catch (e) {
      console.error("Local storage data format is invalid", e);
      localStorage.removeItem("emailScraperResults");
    }
  }
}

function displayResults(data) {
  let html = "";
  if (data && data.length > 0) {
    data.forEach((item, index) => {
      html += createSiteCard(item, index);
    });
  } else {
    html = '<div class="no-results">No results found</div>';
  }
  document.getElementById("result").innerHTML = html;
}

function updateProgress(current, total, message = "") {
  const progressSection = document.getElementById("progressSection");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  if (total > 0) {
    progressSection.style.display = "block";
    const percentage = Math.round((current / total) * 100);
    progressFill.style.width = percentage + "%";
    progressText.textContent =
      message || `${current}/${total} domen yoxlanıldı (${percentage}%)`;
  } else {
    progressSection.style.display = "none";
  }
}

function setLoading(loading) {
  const submitBtn = document.getElementById("submitBtn");
  isProcessing = loading;
  if (loading) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> Checking...';
    document.getElementById("result").innerHTML = "";
    updateProgress(0, 1, "Starting...");
  } else {
    submitBtn.disabled = false;
    submitBtn.innerHTML = "🚀 Start Checking";
    updateProgress(0, 0);
  }
}

function createSiteCard(item, index) {
  const hasStats = item.stats && typeof item.stats === "object";
  const domain = item.site.replace(/^https?:\/\//, "").replace(/^www\./, "");
  let html = `<div class="site-card" data-site="${domain}">`;
  html += `<div class="site-header"><div class="site-title">🌐 <a href="${item.site}" style="color: inherit; text-decoration: none;" target="_blank">${item.site}</a></div>`;

  html += `</div>`;
  if (item.error) {
    html += `<div class="error-message">❌ Error: ${item.error}</div></div>`;
    return html;
  }

  if (item.emails && item.emails.length > 0) {
    html += `<div class="emails-list">`;
    item.emails.forEach((email) => {
      html += `<div class="email-item"><span>${email}</span></div>`;
    });
    html += `</div>`;
  } else {
    html += '<div class="no-results">Email tapılmadı</div>';
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}

document
  .getElementById("websiteForm")
  .addEventListener("submit", async function (e) {
    e.preventDefault();
    if (isProcessing) return;

    const textareaValue = document.getElementById("textarea").value.trim();
    if (!textareaValue) {
      alert("Please enter domain names");
      return;
    }

    const domains = textareaValue
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean);
    if (domains.length === 0) {
      alert("Please write valid domain names");
      return;
    }

    setLoading(true);
    const allResults = [];
    const resultContainer = document.getElementById("result");
    resultContainer.innerHTML = ""; 

    try {
      updateProgress(
        0,
        domains.length,
        "Sending to server. Please wait some time..."
      );
      const response = await fetch("http://localhost:3000/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done;
      let value;

      let completedDomainsCount = 0;

      while (({ value, done } = await reader.read())) {
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); 

        for (const line of lines) {
          if (line.trim()) {
            try {
              const result = JSON.parse(line);
              allResults.push(result);
              resultContainer.innerHTML += createSiteCard(result); 
              completedDomainsCount++;
              updateProgress(
                completedDomainsCount,
                domains.length,
                `${result.site} is done`
              );
            } catch (e) {
              console.error("JSON parse error:", e);
            }
          }
        }
      }
      if (buffer.trim()) {
        try {
          const result = JSON.parse(buffer);
          allResults.push(result);
          resultContainer.innerHTML += createSiteCard(result);
          completedDomainsCount++;
          updateProgress(
            completedDomainsCount,
            domains.length,
            `${result.site} is done`
          );
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      }

      saveResultsToLocalStorage(allResults);
    } catch (err) {
      console.error("Error:", err);
      document.getElementById(
        "result"
      ).innerHTML = `<div class="error-message">❌ Error occurred: ${err.message}</div>`;
    } finally {
      setLoading(false);
      updateProgress(
        domains.length,
        domains.length,
        "All done"
      );
    }
  });

document.getElementById("clearBtn").addEventListener("click", () => {
  if (isProcessing) {
    if (!confirm("Process is ongoing. Do you want to stop?")) {
      return;
    }
  }
  document.getElementById("textarea").value = "";
  document.getElementById("result").innerHTML = "";
  updateProgress(0, 0);
  localStorage.removeItem("emailScraperResults");
});

document.addEventListener("DOMContentLoaded", loadResultsFromLocalStorage);

const textarea = document.getElementById("textarea");
textarea.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.max(120, this.scrollHeight) + "px";
});
