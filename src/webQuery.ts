import puppeteer from "puppeteer";
import { LLMClient } from './lmmClient'


export async function getWebContext(query: string): Promise<{ title: string, text: string, link: string }[]> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );
    const link = `https://bing.com/?q=${encodeURIComponent(query)}`
    await page.goto(link, {
        waitUntil: "domcontentloaded",
    });
    console.log(query)

    await page.waitForSelector(".b_algo");

    const results = await page.$$eval(".b_algo", (elements) =>
        elements.slice(0, 10).map((el) => {
            // Extract the first anchor's href and text (title)
            const a = el.querySelector("a");
            const link = a ? a.href : "";
            const title = a ? a.innerText.trim() : "";

            // Try to extract the snippet/description
            let text = "";
            const caption = el.querySelector(".b_caption p");
            if (caption) {
                text = (caption as HTMLElement).innerText.trim();
            } else {
                // Fallback: get all text, remove anchor text
                text = (el as HTMLElement).innerText.replace(a ? (a as HTMLElement).innerText : "", "").trim();
            }

            return {
                title,
                text,
                link
            };
        })
    );

    await browser.close();
    return results.slice(0, 3);
}



(async function () {
    // const x = await getWebContext('quem é o cantor eskine?');
    // console.log(x);
    const lmm = new LLMClient('http://localhost:1234/v1/chat/completions');
    const answer = await lmm.generateContentWithSystemContext("quem é o artilheiro da arena corinthians?");
    console.log(answer);
})();
