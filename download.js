const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cliProgress = require('cli-progress');

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

function saveState(offset) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ offset }));
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
    return { offset: 0 };
}

async function downloadDataset() {
    const totalRecords = await getDatasetSize();
    const state = readState();
    let offset = state.offset;

    // Validate if existing file matches state
    if (offset > 0 && !fs.existsSync(FILE_PATH)) {
        console.warn('State file exists but dataset file is missing. Starting fresh.');
        offset = 0;
    }

    console.log(`Starting/Resuming download for ${totalRecords.toLocaleString()} records...`);
    console.log(`Current offset: ${offset.toLocaleString()}`);

    const progressBar = new cliProgress.SingleBar({
        format: 'Downloading |' + '{bar}' + '| {percentage}% || {value}/{total} Records || ETA: {eta_formatted}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    progressBar.start(totalRecords, offset);

    // If starting fresh, 'w' (write), else 'a' (append)
    const flags = offset === 0 ? 'w' : 'a';
    const writer = fs.createWriteStream(FILE_PATH, { flags });

    // Calculate initial file size for resume scenarios
    let downloadedBytes = 0;
    if (offset > 0 && fs.existsSync(FILE_PATH)) {
        downloadedBytes = fs.statSync(FILE_PATH).size;
    }

    if (offset === 0) {
        writer.write('['); // Start JSON array
        downloadedBytes += 1; // Count the opening bracket
    }

    let isFirstChunk = offset === 0;

    // Helper to format bytes
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Calculate initial estimates if resuming
    let initialTotalEst = 'Calc...';
    if (offset > 0 && downloadedBytes > 0) {
        const avg = downloadedBytes / offset;
        initialTotalEst = formatBytes(totalRecords * avg);
    }

    // Update progress bar format to include size
    progressBar.stop(); // Stop the old one to reconfigure
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
                        timeout: 45000 // Increased timeout
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
            saveState(offset);
            verboseProgressBar.update(offset, {
                size_downloaded: formatBytes(downloadedBytes),
                size_total_est: formatBytes(estimatedTotalBytes)
            });
        }

        writer.write(']'); // End JSON array
        writer.end();

        // Cleanup state file on success
        if (fs.existsSync(STATE_FILE)) {
            fs.unlinkSync(STATE_FILE);
        }

        verboseProgressBar.stop();
        console.log('\nDownload completed successfully!');

    } catch (error) {
        verboseProgressBar.stop();
        console.error('\nDownload interrupted/failed:', error.message);
        console.log(`Progress saved. Run script again to resume from offset ${offset}.`);
        writer.end();
    }
}

downloadDataset();
