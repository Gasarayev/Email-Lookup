import express from "express";
import puppeteer from "puppeteer";
import chromium from '@sparticuz/chromium';
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio"; 

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SEARCH_KEYWORDS = (process.env.SEARCH_KEYWORDS || "contact,about")
  .split(",")
  .map((k) => k.trim());
const PUPPETEER_HEADLESS = process.env.PUPPETEER_HEADLESS === "true";
const PUPPETEER_TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT, 10) || 60000;
const PUPPETEER_DELAY = parseInt(process.env.PUPPETEER_DELAY, 10) || 6000;

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


async function findEmailsWithCheerio(htmlContent) {
    const emailRegex =
        /(?:[a-zA-Z0-9!#$%&'*+/=?^_{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-zA-Z0-9-]*[a-zA-Z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/g;
    const emails = new Set();
    const $ = cheerio.load(htmlContent);
    const htmlText = $.html();
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
    $('a[href^="mailto:"]').each((i, el) => {
        const email = $(el).attr("href").replace("mailto:", "").split("?")[0];
        if (emailRegex.test(email)) {
            emails.add(email.toLowerCase());
        }
    });
    return Array.from(emails);
}

async function getContactAboutLinks(site) {
    let browser;
    try {
        if (!site.startsWith("http")) site = "https://" + site;

        console.log(`${site} - Cheerio ilə statik yoxlama başladı`);
        const response = await axios.get(site, { timeout: PUPPETEER_TIMEOUT });
        const cheerioEmails = await findEmailsWithCheerio(response.data);
        console.log(`${site} - Cheerio ${cheerioEmails.length} email tapdı`);

        if (cheerioEmails.length > 0) {
            return {
                site,
                emails: cheerioEmails,
                links: [],
                stats: { totalEmails: cheerioEmails.length, method: "Cheerio" },
            };
        }

        console.log(`${site} - Cheerio e-poçt tapmadı. Puppeteer başladı`);
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless
        });
        const page = await browser.newPage();
        await page.goto(site, {
            waitUntil: "networkidle0",
            timeout: PUPPETEER_TIMEOUT,
        });
        await new Promise((resolve) => setTimeout(resolve, PUPPETEER_DELAY));

        const mainEmails = await findEmails(page);
        console.log(`${site} - Main page (Puppeteer) ${mainEmails.length} email found`);

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
                method: "Puppeteer"
            },
        };
    } catch (err) {
        console.error(`${site} error: ${err.message}`);
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
    const domains = req.body.domains || [];
    console.log(`${domains.length} domain will be checked`);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");

    for (let i = 0; i < domains.length; i++) {
        const domain = domains[i].trim();
        console.log(`${i + 1}/${domains.length}: ${domain} started`);

        const result = await getContactAboutLinks(domain);
        console.log(`${domain} completed`);

        res.write(JSON.stringify(result) + "\n");

        if (i < domains.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    console.log(`All domains completed`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log("Web Scraper is ready!");
    console.log("Endpoint:");
    console.log("   POST /check - Domain checking");
});