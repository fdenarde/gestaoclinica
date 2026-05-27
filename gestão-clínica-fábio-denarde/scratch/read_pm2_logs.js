import fs from 'fs';
import path from 'path';
import os from 'os';

const homeDir = os.homedir();
const logDir = path.join(homeDir, '.pm2', 'logs');

function readLastLinesOfLargeFile(filePath, numLines = 150) {
  if (!fs.existsSync(filePath)) {
    return `File not found: ${filePath}`;
  }
  
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const fileSize = stat.size;
  
  const bufferSize = Math.min(65536, fileSize);
  const buffer = Buffer.alloc(bufferSize);
  
  let lines = [];
  let currentPos = fileSize;
  
  while (currentPos > 0 && lines.length <= numLines) {
    const bytesToRead = Math.min(bufferSize, currentPos);
    currentPos -= bytesToRead;
    
    fs.readSync(fd, buffer, 0, bytesToRead, currentPos);
    const chunk = buffer.toString('utf8', 0, bytesToRead);
    const chunkLines = chunk.split('\n');
    
    if (lines.length > 0) {
      // Join the last line of the new chunk with the first line of the old buffer
      chunkLines[chunkLines.length - 1] += lines[0];
      lines = chunkLines.concat(lines.slice(1));
    } else {
      lines = chunkLines;
    }
  }
  
  fs.closeSync(fd);
  return lines.slice(-numLines).join('\n');
}

const errLog = path.join(logDir, 'RoboClinica-error.log');

console.log("=== STDERR LOG (LAST 200 LINES) ===");
console.log(readLastLinesOfLargeFile(errLog, 200));
