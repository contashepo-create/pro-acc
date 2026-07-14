/**
 * Open Banking Integration — Bank Statement Import & Reconciliation
 * 
 * Supports importing bank statements in common formats:
 * - OFX (Open Financial Exchange) — most Saudi banks
 * - MT940 (SWIFT) — international banks
 * - CSV — universal fallback
 * 
 * Usage:
 *   const transactions = await parseBankStatement(fileContent, 'ofx');
 *   const matched = await autoReconcile(transactions, auth.companyId);
 */

interface BankTransaction {
  date: string;           // ISO date
  amount: number;
  description: string;
  reference?: string;
  type: 'credit' | 'debit';
  balance?: number;       // Running balance after this transaction
  bankRef?: string;       // Bank's unique reference for this transaction
}

/**
 * Parse OFX (Open Financial Exchange) bank statement
 */
export function parseOFX(ofxContent: string): BankTransaction[] {
  const transactions: BankTransaction[] = [];
  
  // Extract STMTTRN blocks
  const txnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  
  while ((match = txnRegex.exec(ofxContent)) !== null) {
    const block = match[1];
    
    const getDate = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([^<]+)`));
      if (!m) return '';
      // OFX date format: YYYYMMDD or YYYYMMDDHHMMSS
      const raw = m[1].trim();
      if (raw.length >= 8) {
        return `${raw.substring(0, 4)}-${raw.substring(4, 6)}-${raw.substring(6, 8)}`;
      }
      return raw;
    };

    const getAmount = () => {
      const m = block.match(/<TRNAMT>([^<]+)/);
      return m ? parseFloat(m[1].trim()) : 0;
    };

    const getDescription = () => {
      const name = block.match(/<NAME>([^<]+)/);
      const memo = block.match(/<MEMO>([^<]+)/);
      return [name?.[1], memo?.[1]].filter(Boolean).join(' - ') || '';
    };

    const getRef = () => {
      const m = block.match(/<FITID>([^<]+)/);
      return m?.[1]?.trim();
    };

    const amount = getAmount();
    
    transactions.push({
      date: getDate('DTPOSTED'),
      amount: Math.abs(amount),
      description: getDescription(),
      reference: getRef(),
      type: amount >= 0 ? 'credit' : 'debit',
      bankRef: getRef(),
    });
  }

  return transactions;
}

/**
 * Parse MT940 (SWIFT) bank statement
 */
export function parseMT940(content: string): BankTransaction[] {
  const transactions: BankTransaction[] = [];
  const lines = content.split('\n');
  let currentTxn: Partial<BankTransaction> | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // :61: Statement line (transaction)
    if (trimmed.startsWith(':61:')) {
      if (currentTxn && currentTxn.date) {
        transactions.push(currentTxn as BankTransaction);
      }
      
      // Format: :61:YYMMDDYYMMDDCD amount N... reference
      const m = trimmed.match(/:61:(\d{6})(\d{6})?(C|D|RC|RD)(\d+[,\.]\d*)/);
      if (m) {
        const dateStr = m[1];
        const date = `20${dateStr.substring(0, 2)}-${dateStr.substring(2, 4)}-${dateStr.substring(4, 6)}`;
        const isCredit = m[3] === 'C';
        const amount = parseFloat(m[4].replace(',', '.'));
        
        currentTxn = {
          date,
          amount,
          type: isCredit ? 'credit' : 'debit',
          description: '',
        };
      }
    }
    
    // :86: Transaction details
    if (trimmed.startsWith(':86:') && currentTxn) {
      currentTxn.description = trimmed.substring(4);
    }
  }
  
  if (currentTxn && currentTxn.date) {
    transactions.push(currentTxn as BankTransaction);
  }

  return transactions;
}

/**
 * Parse CSV bank statement
 */
export function parseCSV(content: string, mapping?: {
  dateCol?: number;
  amountCol?: number;
  descriptionCol?: number;
  referenceCol?: number;
  hasHeader?: boolean;
  separator?: string;
}): BankTransaction[] {
  const sep = mapping?.separator || ',';
  const hasHeader = mapping?.hasHeader !== false;
  const dateCol = mapping?.dateCol ?? 0;
  const amountCol = mapping?.amountCol ?? 1;
  const descCol = mapping?.descriptionCol ?? 2;
  const refCol = mapping?.referenceCol ?? 3;

  const lines = content.split('\n').filter(l => l.trim());
  const startIdx = hasHeader ? 1 : 0;
  const transactions: BankTransaction[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    
    if (cols.length < 3) continue;
    
    const amountStr = cols[amountCol]?.replace(/[^0-9.\-]/g, '') || '0';
    const amount = parseFloat(amountStr);
    
    if (isNaN(amount)) continue;
    
    transactions.push({
      date: cols[dateCol] || '',
      amount: Math.abs(amount),
      description: cols[descCol] || '',
      reference: cols[refCol] || undefined,
      type: amount >= 0 ? 'credit' : 'debit',
    });
  }

  return transactions;
}

/**
 * Auto-detect file format and parse
 */
export function parseBankStatement(content: string, format?: 'ofx' | 'mt940' | 'csv'): BankTransaction[] {
  if (!format) {
    // Auto-detect
    if (content.includes('<OFX>') || content.includes('<STMTTRN>')) {
      format = 'ofx';
    } else if (content.includes(':20:') || content.includes(':61:')) {
      format = 'mt940';
    } else {
      format = 'csv';
    }
  }

  switch (format) {
    case 'ofx': return parseOFX(content);
    case 'mt940': return parseMT940(content);
    case 'csv': return parseCSV(content);
    default: return [];
  }
}

/**
 * Auto-reconcile bank transactions with existing journal entries
 * Matches by amount + date proximity + description similarity
 */
export function autoReconcile(
  bankTransactions: BankTransaction[],
  existingEntries: Array<{ date: string; debit: number; credit: number; description: string; id: string }>
): Array<{
  bankTransaction: BankTransaction;
  matchedEntry: typeof existingEntries[0] | null;
  confidence: number;
}> {
  return bankTransactions.map(bankTxn => {
    let bestMatch: typeof existingEntries[0] | null = null;
    let bestScore = 0;

    for (const entry of existingEntries) {
      let score = 0;

      // Amount match (most important)
      const entryAmount = bankTxn.type === 'credit' ? entry.debit : entry.credit;
      if (Math.abs(entryAmount - bankTxn.amount) < 0.01) {
        score += 50;
      }

      // Date proximity (within 3 days)
      const bankDate = new Date(bankTxn.date).getTime();
      const entryDate = new Date(entry.date).getTime();
      const dayDiff = Math.abs(bankDate - entryDate) / 86400000;
      if (dayDiff <= 3) score += 30 - (dayDiff * 10);

      // Description similarity (simple word overlap)
      const bankWords = bankTxn.description.toLowerCase().split(/\s+/);
      const entryWords = entry.description.toLowerCase().split(/\s+/);
      const commonWords = bankWords.filter(w => entryWords.includes(w) && w.length > 2);
      score += Math.min(20, commonWords.length * 5);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    return {
      bankTransaction: bankTxn,
      matchedEntry: bestMatch,
      confidence: bestScore,
    };
  });
}
