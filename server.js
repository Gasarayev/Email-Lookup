import express from "express";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SEARCH_KEYWORDS = (process.env.SEARCH_KEYWORDS || "contact,about")
  .split(",")
  .map((k) => k.trim());

const PUPPETEER_TIMEOUT = 60000;
const PUPPETEER_DELAY = 60000;


const activeJobs = new Map();

async function findAllLinks(page) {
  return await page.evaluate(() => {
    const links = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      let href = a.href;
      if (
        href &&
        !href.startsWith("javascript:") &&
        !href.startsWith("mailto:") &&
        !href.startsWith("tel:")
      ) {
        links.add(href);
      }
    });
    return Array.from(links);
  });
}

async function findEmails(page) {
  return await page.evaluate(() => {
    const emailRegex =
      /(?:[a-zA-Z0-9!#$%&'*+/=?^_{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-zA-Z0-9-]*[a-zA-Z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/g;
    const emails = new Set();
    const htmlText = document.documentElement.outerHTML;
    const htmlMatches = htmlText.match(emailRegex) || [];
    htmlMatches.forEach((email) => {
      if (
        !email.includes("example.com") &&
        !email.includes("test.com") &&
        !email.includes("domain.com")
      ) {
        emails.add(email.toLowerCase());
      }
    });
    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const email = a.href.replace("mailto:", "").split("?")[0];
      if (emailRegex.test(email)) {
        emails.add(email.toLowerCase());
      }
    });
    return Array.from(emails);
  });
}

async function getContactAboutLinks(site, jobId) {
  let browser;
  try {
    if (!site.startsWith("http")) site = "https://" + site;

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

   
    if (activeJobs.has(jobId)) {
      activeJobs.get(jobId).browser = browser;
    }

    const page = await browser.newPage();
    await page.goto(site, {
      waitUntil: "networkidle0",
      timeout: PUPPETEER_TIMEOUT,
    });

   
    if (!activeJobs.get(jobId)?.active) return null;

    await new Promise((resolve) => setTimeout(resolve, PUPPETEER_DELAY));

    const mainEmails = await findEmails(page);
    const allLinks = await findAllLinks(page);

    const contactAboutLinks = allLinks.filter((link) => {
      const lowerLink = link.toLowerCase();
      const isKeywordLink = SEARCH_KEYWORDS.some((keyword) =>
        lowerLink.includes(keyword)
      );
      return isKeywordLink && link.startsWith(new URL(site).origin);
    });

    const contactAboutEmails = [];
    for (const link of contactAboutLinks) {
      if (!activeJobs.get(jobId)?.active) return null;
      try {
        await page.goto(link, {
          waitUntil: "networkidle0",
          timeout: PUPPETEER_TIMEOUT,
        });
        await new Promise((resolve) => setTimeout(resolve, PUPPETEER_DELAY));
        const emails = await findEmails(page);
        contactAboutEmails.push(...emails);
      } catch (err) {
        console.log(`${link} failed to load: ${err.message}`);
      }
    }

    const allEmails = Array.from(
      new Set([...mainEmails, ...contactAboutEmails])
    );

    return {
      site,
      links: contactAboutLinks,
      emails: allEmails,
      stats: {
        totalLinks: allLinks.length,
        contactLinks: contactAboutLinks.length,
        mainPageEmails: mainEmails.length,
        contactPageEmails: contactAboutEmails.length,
        totalEmails: allEmails.length,
      },
    };
  } catch (err) {
    return {
      site,
      error: err.message,
      links: [],
      emails: [],
      stats: null,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}


app.post("/check", async (req, res) => {
  const { domains, jobId } = req.body;
  if (!domains || !Array.isArray(domains) || !jobId) {
    return res.status(400).json({ error: "domains and jobId required" });
  }

  activeJobs.set(jobId, { active: true, browser: null });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  for (let i = 0; i < domains.length; i++) {
    if (!activeJobs.get(jobId)?.active) break;
    const domain = domains[i].trim();
    const result = await getContactAboutLinks(domain, jobId);
    if (!result) break;
    res.write(JSON.stringify(result) + "\n");
    if (i < domains.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  activeJobs.delete(jobId);
  res.end();
});


app.post("/cancel", async (req, res) => {
  const { jobId } = req.body;
  if (activeJobs.has(jobId)) {
    const job = activeJobs.get(jobId);
    job.active = false;
    if (job.browser) {
      try {
        await job.browser.close();
      } catch (e) {}
    }
    return res.json({ message: "Job cancelled" });
  }
  res.status(404).json({ error: "Job not found" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
