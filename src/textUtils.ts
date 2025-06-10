import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// import natural from 'natural';
// const stemmer = natural.PorterStemmer;

const stopwords = new Set([
  "the", "is", "in", "at", "of", "on", "and", "a", "to", "it", "for", "with", "as", "by", "an", "be", "this", "that", "from", "or", "are", "was", "but", "not", "have", "has", "had"
]);
// Lista de stopwords em português
export const stopwordsPT: Set<string> = new Set([
  "a", "à", "agora", "ainda", "além", "algo", "alguém", "algum", "alguma", "algumas", "alguns",
  "ampla", "amplas", "amplo", "amplos", "ante", "antes", "ao", "aos", "apenas", "apoio", "após",
  "aquela", "aquelas", "aquele", "aqueles", "aqui", "aquilo", "as", "até", "através", "bastante",
  "bem", "boa", "boas", "bom", "bons", "breve", "cá", "cada", "catorze", "cedo", "cento", "certamente",
  "certeza", "cima", "cinco", "coisa", "coisas", "com", "como", "conselho", "contra", "contudo",
  "da", "daquele", "daqueles", "das", "de", "debaixo", "dela", "delas", "dele", "deles", "demais",
  "dentro", "depois", "desde", "dessa", "dessas", "desse", "desses", "desta", "destas", "deste",
  "destes", "deve", "devem", "devendo", "dever", "deverá", "deverão", "deveria", "deveriam", "devia",
  "deviam", "disse", "disso", "disto", "dito", "diz", "do", "dois", "dos", "doze", "duas", "e",
  "é", "ela", "elas", "ele", "eles", "em", "embora", "enquanto", "entre", "era", "eram", "éramos",
  "essa", "essas", "esse", "esses", "esta", "está", "estamos", "estão", "estar", "estas", "estava",
  "estavam", "estávamos", "este", "esteja", "estejam", "estejamos", "estes", "esteve", "estive",
  "estivemos", "estiver", "estivera", "estiveram", "estivéramos", "estiverem", "estivermos", "estivesse",
  "estivessem", "estivéssemos", "estou", "eu", "fará", "favor", "faz", "fazeis", "fazem", "fazemos",
  "fazendo", "fazer", "fazes", "feita", "feitas", "feito", "feitos", "fez", "fim", "final", "foi",
  "fomos", "for", "fora", "foram", "fôramos", "forem", "forma", "for mos", "fosse", "fossem", "fôssemos",
  "fui", "geral", "grande", "grandes", "há", "isso", "isto", "já", "la", "lá", "lhe", "lhes", "lo",
  "logo", "longe", "lugar", "maior", "maioria", "mais", "mal", "mas", "máximo", "me", "mediante", "meio",
  "menor", "menos", "mesma", "mesmas", "mesmo", "mesmos", "meu", "meus", "minha", "minhas", "momento",
  "muito", "muitos", "na", "nada", "não", "naquela", "naquelas", "naquele", "naqueles", "nas", "nem",
  "nenhum", "nessa", "nessas", "nesse", "nesses", "nesta", "nestas", "neste", "nestes", "ninguém",
  "nível", "no", "nos", "nós", "nossa", "nossas", "nosso", "nossos", "nova", "novas", "novo", "novos",
  "num", "numa", "nunca", "o", "obra", "obrigada", "obrigado", "oitava", "oitavo", "oito", "onde",
  "ontem", "onze", "os", "ou", "outra", "outras", "outro", "outros", "para", "parece", "parte", "partir",
  "pela", "pelas", "pelo", "pelos", "per", "perante", "perto", "pode", "podem", "poder", "poderia",
  "poderiam", "podia", "podiam", "pois", "ponto", "por", "porque", "porquê", "posição", "possível",
  "possivelmente", "posso", "pouca", "poucas", "pouco", "poucos", "primeira", "primeiras", "primeiro",
  "primeiros", "própria", "próprias", "próprio", "próprios", "próxima", "próximas", "próximo", "próximos",
  "pude", "pudemos", "puderam", "quais", "qual", "quando", "quanto", "quantos", "quarta", "quarto",
  "quatro", "que", "quem", "quer", "quereis", "querem", "queremas", "queres", "quero", "questão",
  "quinta", "quinto", "quinze", "relação", "sabe", "sabem", "são", "se", "segunda", "segundo", "sei",
  "seis", "seja", "sejam", "sejamos", "sem", "sempre", "sendo", "ser", "será", "serão", "serei",
  "seremos", "seria", "seriam", "seríamos", "sete", "sétima", "sétimo", "seu", "seus", "si", "sido",
  "sim", "sistema", "só", "sob", "sobre", "sois", "somos", "sou", "sua", "suas", "tal", "talvez",
  "também", "tampouco", "te", "tem", "têm", "temos", "tendes", "tenho", "tens", "tentar", "tentaram",
  "tente", "tentei", "ter", "terá", "terão", "terei", "teremos", "teria", "teriam", "teríamos", "teu",
  "teus", "teve", "tinha", "tinham", "tínhamos", "tive", "tivemos", "tiver", "tivera", "tiveram",
  "tivéramos", "tiverem", "tivermos", "tivesse", "tivessem", "tivéssemos", "toda", "todas", "todo",
  "todos", "trabalho", "três", "treze", "tu", "tua", "tuas", "tudo", "última", "últimas", "último",
  "últimos", "um", "uma", "umas", "uns", "usa", "usar", "vai", "vais", "vamos", "vão", "vários",
  "vem", "vêm", "vendo", "vens", "ver", "vez", "vezes", "viagem", "vindo", "vinte", "você", "vocês",
  "vos", "vós", "vossa", "vossas", "vosso", "vossos"
]);


// Example: Clean and split your web search content

export function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/http\S+/g, '')
    .replace(/\S+@\S+/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word && !new Set([...stopwords, ...stopwordsPT]).has(word))
    // .map(word => stemmer.stem(word)) // Apply stemming
    .join(' ')
    .trim();
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
