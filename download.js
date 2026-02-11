const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cliProgress = require('cli-progress');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, 'data');
const FILE_PATH = path.join(DATA_DIR, 'dataset.json');
const STATE_FILE = path.join(DATA_DIR, 'download_state.json');
const BASE_URL = 'https://data.cityofchicago.org/resource/wrvz-psew.json';
const CHUNK_SIZE = 50000;
const HARDCODED_TOTAL = 211670894;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function getDatasetSize() {
    try {
        console.log('Attempting to fetch dataset size (5s timeout)...');
        const response = await axios.get(`${BASE_URL}?$select=count(*)`, { timeout: 5000 });
        if (response.data && response.data.length > 0 && response.data[0].count) {
            return parseInt(response.data[0].count);
        }
    } catch (error) {
        console.warn(`Failed to fetch size automatically: ${error.message}`);
    }
    console.log(`Fallback to hardcoded size: ${HARDCODED_TOTAL}`);
    return HARDCODED_TOTAL;
}

function saveState(offset, limitBytes) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ offset, limitBytes }));
}

function readState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Error reading state file, starting fresh.');
        }
    }
    return { offset: 0, limitBytes: null };
}

function askUserForLimit(currentOffset, savedLimitBytes) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Scenario: Resume with existing limit
        if (savedLimitBytes !== null && savedLimitBytes !== undefined) {
            if (currentOffset < savedLimitBytes) {
                const remaining = savedLimitBytes - currentOffset;
                console.log(`\nPrevious limit: ${formatBytes(savedLimitBytes)} (Remaining: ${formatBytes(remaining)})`);
                rl.question(`Resume to limit of ${formatBytes(savedLimitBytes)}? [Y/n/extend]: `, (answer) => {
                    const choice = answer.trim().toLowerCase();
                    if (choice === 'n') {
                        // User wants to change limit or go all
                        askNewLimit(rl, resolve);
                    } else if (choice === 'extend' || choice === 'e') {
                        askToExtend(rl, resolve, savedLimitBytes);
                    } else {
                        // Default Yes
                        console.log(`Resuming with limit ${formatBytes(savedLimitBytes)}.`);
                        rl.close();
                        resolve(savedLimitBytes);
                    }
                });
                return;
            } else {
                // Limit reached or exceeded
                console.log(`\nPrevious limit of ${formatBytes(savedLimitBytes)} reached.`);
                askToExtend(rl, resolve, savedLimitBytes);
                return;
            }
        }

        // Scenario: Fresh start or no previous limit
        askNewLimit(rl, resolve);
    });
}

function askNewLimit(rl, resolve) {
    rl.question('Do you want to download (A)ll or set a (L)imit in GB? [A/L]: ', (answer) => {
        const choice = answer.trim().toUpperCase();
        if (choice === 'L') {
            rl.question('Enter limit in GB (e.g., 5): ', (limitInput) => {
                const limitGB = parseFloat(limitInput);
                if (isNaN(limitGB) || limitGB <= 0) {
                    resolve(null);
                } else {
                    const limitBytes = Math.floor(limitGB * 1024 * 1024 * 1024);
                    console.log(`Download limit set to ${limitGB} GB (${limitBytes.toLocaleString()} bytes).`);
                    rl.close();
                    resolve(limitBytes);
                }
            });
        } else {
            console.log('Download set to ALL.');
            rl.close();
            resolve(null);
        }
    });
}

function askToExtend(rl, resolve, currentLimit) {
    rl.question(`Limit reached. Add more GB? (Enter number, e.g. 1, or 'A' for all, 'N' to exit): `, (answer) => {
        const choice = answer.trim().toUpperCase();
        if (choice === 'N') {
            rl.close();
            process.exit(0); // Exit gracefully
        } else if (choice === 'A') {
            console.log('Removing limit. Downloading ALL.');
            rl.close();
            resolve(null);
        } else {
            const addedGB = parseFloat(choice);
            if (isNaN(addedGB) || addedGB <= 0) {
                console.log('Invalid input. Exiting.');
                rl.close();
                process.exit(0);
            } else {
                const addedBytes = Math.floor(addedGB * 1024 * 1024 * 1024);
                // Check if currentLimit is null/undefined (recovering from 'All' state but hitting logic error? or user asked to extend from 'All'?)
                // If previous was 'All', currentLimit is null.
                // But this function is only called if limit was reached.
                // If user was downloading ALL, we usually don't prompt "Limit reached".
                // So currentLimit should be a number here.
                const base = currentLimit || 0;
                const newLimit = base + addedBytes;
                console.log(`Extended limit by ${addedGB} GB. New limit: ${formatBytes(newLimit)}.`);
                rl.close();
                resolve(newLimit);
            }
        }
    });
}

// Helper to format bytes
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

async function downloadDataset() {
    // Read state first to know current offset
    const state = readState();
    let offset = state.offset;

    // Determine downloaded bytes based on FILE_PATH size if it exists, for consistency with offset
    let downloadedBytes = 0;
    if (offset > 0 && fs.existsSync(FILE_PATH)) {
        downloadedBytes = fs.statSync(FILE_PATH).size;
    }

    // Now ask user, passing current offset and saved limit
    const sizeLimitBytes = await askUserForLimit(downloadedBytes, state.limitBytes);

    // Only fetch total records if we are proceeding
    const totalRecords = await getDatasetSize();
    let initialTotalEst = 'Calc...';
    if (offset > 0 && downloadedBytes > 0) {
        const avg = downloadedBytes / offset;
        initialTotalEst = formatBytes(totalRecords * avg);
    }

    console.log(`Starting/Resuming download for ${totalRecords.toLocaleString()} records...`);
    console.log(`Current offset: ${offset.toLocaleString()}`);

    const verboseProgressBar = new cliProgress.SingleBar({
        format: 'Downloading |' + '{bar}' + '| {percentage}% || {value}/{total} Recs || {size_downloaded}/{size_total_est} || ETA: {eta_formatted}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    verboseProgressBar.start(totalRecords, offset, {
        size_downloaded: formatBytes(downloadedBytes),
        size_total_est: initialTotalEst
    });

    const flags = offset === 0 ? 'w' : 'a';
    const writer = fs.createWriteStream(FILE_PATH, { flags });

    if (offset === 0) {
        writer.write('['); // Start JSON array
        downloadedBytes += 1; // Count the opening bracket
    }

    let isFirstChunk = offset === 0;

    try {
        while (offset < totalRecords) {
            let retries = 3;
            let records = [];

            while (retries > 0) {
                try {
                    const response = await axios.get(BASE_URL, {
                        params: {
                            '$limit': CHUNK_SIZE,
                            '$offset': offset,
                            '$order': ':id'
                        },
                        timeout: 60000 // 60s timeout for ~50MB chunks
                    });
                    records = response.data;
                    break;
                } catch (e) {
                    retries--;
                    if (retries === 0) throw e;
                    console.log(`\nRetry ${3 - retries}/3 for offset ${offset}...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            if (records.length === 0) break;

            // Check if adding this chunk would exceed the limit (if set)
            if (sizeLimitBytes !== null && downloadedBytes >= sizeLimitBytes) {
                console.log(`\n\nReached download limit of ${formatBytes(sizeLimitBytes)}.`);
                break;
            }

            let chunkData = '';
            for (let i = 0; i < records.length; i++) {
                // If not strictly the first chunk (either in this run or previous), add comma
                if (!isFirstChunk || i > 0) {
                    chunkData += ',';
                }
                chunkData += JSON.stringify(records[i]);
            }

            // Write chunk to file
            const chunkBuffer = Buffer.from(chunkData);
            const canWrite = writer.write(chunkBuffer);
            downloadedBytes += chunkBuffer.length;

            if (!canWrite) {
                await new Promise(resolve => writer.once('drain', resolve));
            }

            offset += records.length;
            isFirstChunk = false;

            // Calculate estimates
            const avgBytesPerRecord = downloadedBytes / (offset || 1);
            const estimatedTotalBytes = totalRecords * avgBytesPerRecord;

            // Update state file
            saveState(offset, sizeLimitBytes);
            verboseProgressBar.update(offset, {
                size_downloaded: formatBytes(downloadedBytes),
                size_total_est: formatBytes(estimatedTotalBytes)
            });
        }

        // Only close array if we actually finished or we are just suspending
        // If we reached limit, we might resume later, so we probably shouldn't close the JSON array yet?
        // But if we want valid JSON on disk at all times...
        // The original logic wrote ']' at the end.
        // If we stop due to limit, we might want to resume.
        // If we write ']' now, resume logic needs to remove it?
        // The current resume logic appends. If we write ']', next time we append, we get `]...more data`.
        // So we strictly should NOT write ']' if we are pausing/limiting.
        // BUT, if the user reads the file, it's invalid JSON.
        // For a download utility like this, usually incomplete download is fine to be invalid.
        // OR we can simple allow append to continue past `]`.
        // For now, let's strictly closing only if we finished ALL records.

        if (offset >= totalRecords) {
            writer.write(']'); // End JSON array
            console.log('\nDownload completed successfully!');
            // Cleanup state file on success
            if (fs.existsSync(STATE_FILE)) {
                fs.unlinkSync(STATE_FILE);
            }
        } else {
            console.log(`\nPaused/Stopped at offset ${offset}. Run again to resume.`);
        }

        writer.end();
        verboseProgressBar.stop();

    } catch (error) {
        verboseProgressBar.stop();
        console.error('\nDownload interrupted/failed:', error.message);
        console.log(`Progress saved. Run script again to resume from offset ${offset}.`);
        saveState(offset, sizeLimitBytes); // Ensure limit is saved on error too
        writer.end();
    }
}

downloadDataset();
