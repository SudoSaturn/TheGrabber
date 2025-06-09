import { Action, ActionPanel, Clipboard, Form, List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { debridUrl } from "./utils/api";
import { getPreferenceValues } from "@raycast/api";
import archiver from "archiver";

interface Preferences {
  apikey: string;
}

const DOWNLOADS_DIR = path.join(process.env.HOME || "~", "Downloads", "alldebrid-downloads");
const HISTORY_FILE = path.join(DOWNLOADS_DIR, "downloads-history.json");

function extractLinks(text: string): string[] {
  // Regex for http(s) links only (no magnets since we removed that functionality)
  const regex = /(https?:\/\/[^\s"']+)/gi;
  const matches = text.match(regex) || [];
  
  // Filter out any non-URLs and trim whitespace
  const urls = matches
    .map(url => url.trim())
    .filter(url => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });
  
  console.log(`[extractLinks] Found ${urls.length} links:`, urls);
  return urls;
}

function wrapAlldebridLink(url: string): string {
  if (url.startsWith("https://alldebrid.com/f/")) {
    return `https://alldebrid.com/service?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export default function Command() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  // Clipboard detection to automatically paste links
  useEffect(() => {
    async function fetchClipboard() {
      try {
        const clipboardText = await Clipboard.readText();
        if (clipboardText) {
          const foundLinks = extractLinks(clipboardText);
          if (foundLinks.length > 0) {
            console.log(`[Clipboard] Found ${foundLinks.length} links in clipboard`);
            setInput(foundLinks.join("\n"));
          }
        }
      } catch (error) {
        console.error("Error reading clipboard:", error);
      }
    }
    
    // Only fetch clipboard if input is empty
    if (!input) {
      fetchClipboard();
    }
  }, []); // Run only on component mount

  useEffect(() => {
    if (showHistory) {
      if (fs.existsSync(HISTORY_FILE)) {
        const content = fs.readFileSync(HISTORY_FILE, "utf-8");
        setHistory(JSON.parse(content));
      } else {
        setHistory([]);
      }
    }
  }, [showHistory]);

  function handleShowHistory() {
    setShowHistory(true);
  }
  function handleShowDownload() {
    setShowHistory(false);
  }

  if (showHistory) {
    return (
      <List
        isLoading={false}
        searchBarPlaceholder="Search downloads..."
        actions={
          <ActionPanel>
            <Action title="Back to Download" onAction={handleShowDownload} />
          </ActionPanel>
        }
      >
        {history.map((entry, idx) => {
          // Get filename without extension
          const fullFilename = entry.title || path.basename(entry.output || "");
          const filenameWithoutExt = fullFilename.replace(/\.[^/.]+$/, "");
          
          // Get file size
          let fileSize = "";
          try {
            if (entry.output && fs.existsSync(entry.output)) {
              const stats = fs.statSync(entry.output);
              fileSize = (stats.size / (1024 * 1024)).toFixed(2) + " MB";
            }
          } catch (err) {
            console.error("Error getting file size:", err);
          }
          
          // Format date as a readable string
          const downloadDate = new Date(entry.date);
          const dateString = downloadDate.toLocaleDateString();
          const timeString = downloadDate.toLocaleTimeString();
          
          return (
            <List.Item
              key={idx}
              title={filenameWithoutExt}
              subtitle={`${dateString} ${timeString} · ${fileSize}`}
              accessories={[{ date: downloadDate }]}
              detail={<List.Item.Detail markdown={`**File:** ${fullFilename}\n\n**Size:** ${fileSize}\n\n**Date:** ${dateString} ${timeString}\n\n**Path:** ${entry.output}`} />}
            />
          );
        })}
      </List>
    );
  }

  async function handleSubmit() {
    setLoading(true);
    const linkList = extractLinks(input);
    if (linkList.length === 0) {
      showToast({ title: "No links found", style: Toast.Style.Failure });
      setLoading(false);
      return;
    }
    
    // Check for duplicate links
    const uniqueLinks = [...new Set(linkList)];
    if (uniqueLinks.length < linkList.length) {
      const duplicateCount = linkList.length - uniqueLinks.length;
      showToast({
        title: `${duplicateCount} duplicate link(s) found`,
        message: "Duplicate links will be processed only once",
        style: Toast.Style.Animated
      });
    }
    
    // Check if links already exist in history
    let history: any[] = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
      } catch (err) {
        console.error("Error reading history file:", err);
      }
    }
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }
    
    try {
      // Prepare for multiple downloads
      const downloadedFiles: string[] = [];
      const downloadedFilenames: string[] = [];
      
      // Process each unique link
      for (const link of uniqueLinks) {
        try {
          // Check if this link was previously downloaded
          const previousDownload = history.find(entry => 
            Array.isArray(entry.links) && entry.links.includes(link)
          );
          
          if (previousDownload) {
            // Ask user if they want to download again
            const confirmToast = await showToast({
              title: "Link was previously downloaded",
              message: `Downloaded on ${new Date(previousDownload.date).toLocaleDateString()}. Re-downloading...`,
              style: Toast.Style.Animated,
              primaryAction: {
                title: "Cancel",
                onAction: () => {
                  showToast({ title: "Download cancelled", style: Toast.Style.Failure });
                  return Promise.reject("Download cancelled by user");
                },
              },
            });
          }
          
          console.log(`[Processing] Unlocking link: ${link}`);
          const result = await debridUrl(link);
          
          if (result.isOk()) {
            const downloadUrl = result.value;
            console.log(`[Success] Got download URL: ${downloadUrl}`);
            
            // Extract filename from URL, ensure it's not empty
            let filename = path.basename(new URL(downloadUrl).pathname);
            if (!filename || filename === "/") {
              // If no filename in URL, use a generic one with timestamp
              filename = `download-${Date.now()}.bin`;
            }
            
            // Ensure filename is URL decoded
            filename = decodeURIComponent(filename);
            console.log(`[Download] Starting download of: ${filename}`);
            
            const filePath = await downloadFile(downloadUrl, filename);
            console.log(`[Download] Completed: ${filePath}`);
            
            // Add to our list of downloaded files
            downloadedFiles.push(filePath);
            downloadedFilenames.push(filename);
            
            // If only one file, show individual success
            if (uniqueLinks.length === 1) {
              showToast({ title: "Download complete!", message: filePath, style: Toast.Style.Success });
            } else {
              // For multiple files, show progress
              showToast({ 
                title: `Download ${downloadedFiles.length}/${uniqueLinks.length} complete`, 
                message: filename,
                style: Toast.Style.Success 
              });
            }
          } else {
            console.error(`[Error] Failed to unlock link: ${link}`);
            showToast({ title: "Failed to unlock link", message: link, style: Toast.Style.Failure });
          }
        } catch (err: any) {
          if (err === "Download cancelled by user") continue;
          showToast({ title: "Download error", message: err.message, style: Toast.Style.Failure });
        }
      }
      
      // Handle multiple downloads - zip them together
      if (downloadedFiles.length > 1) {
        const zipToast = await showToast({ 
          title: "Zipping files", 
          message: `Combining ${downloadedFiles.length} files into a single archive...`,
          style: Toast.Style.Animated 
        });
        
        // Create a zip file with timestamp to avoid name conflicts
        const zipFilename = `alldebrid-downloads-${Date.now()}.zip`;
        const zipFilePath = path.join(DOWNLOADS_DIR, zipFilename);
        
        // Zip the files
        await zipFiles(downloadedFiles, zipFilePath);
        
        // Save to history as a single entry
        saveHistory({
          date: new Date().toISOString(),
          title: zipFilename,
          links: uniqueLinks,
          output: zipFilePath,
          containedFiles: downloadedFilenames // Store the contained filenames
        });
        
        zipToast.hide();
        showToast({ 
          title: "All downloads complete!", 
          message: `${downloadedFiles.length} files zipped to ${zipFilename}`, 
          style: Toast.Style.Success 
        });
        
        // Optionally delete the individual files after zipping
        downloadedFiles.forEach(file => {
          try {
            fs.unlinkSync(file);
          } catch (err) {
            console.error(`Failed to delete ${file}:`, err);
          }
        });
      } 
      // For single file downloads, save to history
      else if (downloadedFiles.length === 1) {
        const filePath = downloadedFiles[0];
        const filename = downloadedFilenames[0];
        
        saveHistory({
          date: new Date().toISOString(),
          title: filename,
          links: uniqueLinks,
          output: filePath,
        });
      }
    } catch (err: any) {
      showToast({ title: "Error processing downloads", message: err.message, style: Toast.Style.Failure });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Download" onSubmit={handleSubmit} loading={loading} />
          <Action title="Show Download History" onAction={handleShowHistory} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="input"
        title="Paste links"
        placeholder="Paste direct links here (one per line)..."
        value={input}
        onChange={setInput}
        autoFocus
      />
    </Form>
  );
}

async function downloadFile(url: string, filename: string) {
  // Ensure filename is safe for filesystem
  filename = filename.replace(/[/\\?%*:|"<>]/g, '_');
  const filePath = path.join(DOWNLOADS_DIR, filename);
  const writer = fs.createWriteStream(filePath);

  // Show a toast with progress
  const progressToast = await showToast({
    title: `Downloading ${filename}`,
    message: "Starting download...",
    style: Toast.Style.Animated,
  });

  // Use the real URL with proper headers
  const realUrl = wrapAlldebridLink(url);
  console.log(`[downloadFile] Downloading from: ${realUrl}`);
  
  try {
    const response = await axios.get(realUrl, {
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": "https://alldebrid.com/"
      },
      maxRedirects: 5,
      timeout: 30000, // 30 second timeout
    });

  let downloadedBytes = 0;
  const totalBytes = parseInt(response.headers["content-length"] || "0");
  let lastProgressUpdate = Date.now();

  response.data.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    
    // Update progress toast every 500ms to avoid too many updates
    const now = Date.now();
    if (now - lastProgressUpdate > 500) {
      lastProgressUpdate = now;
      
      // Calculate progress percentage if content-length is available
      if (totalBytes > 0) {
        const percentage = Math.round((downloadedBytes / totalBytes) * 100);
        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        progressToast.message = `${percentage}% (${downloadedMB}MB / ${totalMB}MB)`;
      } else {
        // If content-length is not available, just show downloaded size
        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
        progressToast.message = `${downloadedMB}MB downloaded`;
      }
    }
  });

  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", (err: Error) => {
      console.error(`[Download] Writer error:`, err);
      progressToast.hide();
      reject(err);
    });
    response.data.on("error", (err: Error) => {
      console.error(`[Download] Stream error:`, err);
      progressToast.hide();
      reject(err);
    });
    
    // Add timeout safety
    const timeout = setTimeout(() => {
      console.error(`[Download] Timeout after 5 minutes`);
      progressToast.hide();
      reject(new Error("Download timed out after 5 minutes"));
    }, 5 * 60 * 1000); // 5 minutes timeout
    
    // Clear timeout on success
    writer.on("finish", () => clearTimeout(timeout));
  });
  } catch (err) {
    console.error(`[Download] Axios error:`, err);
    progressToast.hide();
    throw err;
  }

  progressToast.hide();
  
  // Verify the file exists and has content
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Download] Finished: ${filePath} (${sizeMB} MB)`);
    
    // Check if file is empty or too small (less than 1KB)
    if (stats.size < 1024) {
      console.warn(`[Warning] Downloaded file is very small: ${stats.size} bytes`);
    }
    
    return filePath;
  } else {
    throw new Error(`File download failed: ${filePath} does not exist`);
  }
}

async function zipFiles(filePaths: string[], outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create output stream
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: { level: 6 } // Compression level (0-9)
    });
    
    // Listen for all archive data to be written
    output.on("close", () => {
      resolve(outputPath);
    });
    
    // Handle errors
    archive.on("error", (err: Error) => {
      reject(err);
    });
    
    // Pipe archive data to the output file
    archive.pipe(output);
    
    // Add each file to the archive
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const filename = path.basename(filePath);
        archive.file(filePath, { name: filename });
      }
    }
    
    // Finalize the archive
    archive.finalize();
  });
}

function saveHistory(entry: any) {
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  }
  history.unshift(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}
