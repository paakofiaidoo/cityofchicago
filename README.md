# Chicago Taxi Trips Downloader 🚖

Welcome! This is a simple tool designed to help you download the massive **City of Chicago Taxi Trips** dataset (over 200 million records!) safely and reliably.

Because the dataset is so large, downloading it all at once frequently fails. This tool solves that problem by downloading it in small chunks and saving your progress.

## ✅ Prerequisites

Before you start, make sure you have **Node.js** installed on your computer.
-   If you don't have it, download the "LTS" version from [nodejs.org](https://nodejs.org/).
-   To check if you have it, open your terminal (Command Prompt on Windows, Terminal on Mac) and type:
    ```bash
    node -v
    ```
    If it shows a version number (like `v18.x.x`), you are good to go!

## 🚀 Setup

1.  **Download this folder** to your computer.
2.  Open your **Terminal** or **Command Prompt**.
3.  Navigate to this folder using the `cd` command. For example:
    ```bash
    cd path/to/cityofchicago
    ```
4.  Install the necessary libraries by running:
    ```bash
    npm install
    ```
    (This will create a `node_modules` folder. You can ignore it, but don't delete it!)

## ▶️ How to Run

To start the download, simply run:

```bash
npm run download
```

### What will happen?
1.  **Checking Size**: The script will first check how big the dataset is.
    *   *Note: Sometimes the City of Chicago server is slow. If it takes too long, the script will automatically switch to a manual mode and assume there are ~211 million records.*
2.  **Downloading**: You will see a progress bar showing you exactly how many records have been downloaded and how much time is left.
    ```text
    Downloading |██████████░░░░░░░░░░░░| 32% || 67,500,000/211,670,894 Records || ETA: 2h 15m
    ```
3.  **Result**: When finished, you will find a file named `dataset.json` inside the `data` folder.

## ⏸️ Pausing and Resuming

**This is the best part!**
If your internet cuts out, or you need to turn off your computer, **you don't have to start over.**

1.  Press `Ctrl + C` in the terminal to stop the script.
2.  When you are ready to continue, just run `npm run download` again.
3.  The script will automatically detect where you left off and resume downloading from that exact spot! 🪄

## 🧠 How it Works (For the Curious)

Normally, trying to download a 50GB+ file in one go is risky. If it fails at 99%, you lose everything. Here is how we fixed that:

1.  **Pagination (Chunks)**: Instead of asking for the whole pie, we ask for one slice at a time (50,000 records). We save that slice, then ask for the next one.
2.  **Streaming**: We write these slices directly to your hard drive immediately. This ensures your computer's RAM (memory) doesn't get full and crash.
3.  **State File**: We stick a tiny file called `download_state.json` in the folder. It effectively says *"I have downloaded 1,500,000 records so far"*.
    *   When you run the script, it first looks for this note.
    *   If it finds it, it skips the first 1,500,000 records and starts downloading record #1,500,001.
    *   If it doesn't find it, it starts from the beginning.
