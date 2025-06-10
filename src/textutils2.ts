import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import natural from 'natural';
const stemmer = natural.PorterStemmer;
import franc from 'franc-min';
import { removeStopwords, eng, por } from 'stopword';

const stopwordMap = {
  'eng': eng,
  'por': por,
};
// Example: Clean and split your web search content

export function cleanText(text: string): string {
  // Basic cleaning
  let cleaned = text
    .replace(/<[^>]*>/g, '')         // Remove HTML tags
    .replace(/http\S+/g, '')         // Remove URLs
    .replace(/\S+@\S+/g, '')         // Remove emails
    .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, '') // Remove non-alphanumeric (including accents)
    .toLowerCase()
    .trim();

  // Detect language
  const langCode = (franc as unknown as (input: string, options?: any) => string)(cleaned, { minLength: 10 }) as keyof typeof stopwordMap; // Returns ISO 639-3 code

  // Split into words
  let words = cleaned.split(/\s+/);

  // Remove stopwords if supported
  const stopwords = stopwordMap[langCode];
  if (stopwords) {
    words = removeStopwords(words, stopwords);
  } else {
    // Fallback: English stopwords
    words = removeStopwords(words, eng);
  }

  return words.map(word => stemmer.stem(word)).join(' ');
}

export async function curateAndChunk(rawContent: string) {
  const cleaned = cleanText(rawContent);

  // Use LangChain's text splitter for chunking
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 100, // Adjust as needed
    chunkOverlap: 20,
  });
  const chunks = await splitter.splitText(cleaned);

  return chunks;
}
