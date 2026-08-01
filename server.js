const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const { botToken, chatId } = req.body;
        const file = req.file;
        if (!file || !botToken || !chatId) {
            return res.status(400).json({ error: 'Missing file, botToken, or chatId' });
        }

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', fs.createReadStream(file.path), { filename: file.originalname });

        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendDocument`, formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 120000
        });

        fs.unlinkSync(file.path);

        if (response.data.ok) {
            res.json({ success: true, fileId: response.data.result.document.file_id });
        } else {
            res.status(500).json({ error: 'Telegram upload failed' });
        }
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.response?.data?.description || err.message });
    }
});

// Turbo Parallel Stream Stitcher for Fast Downloading
app.post('/api/download', async (req, res) => {
    try {
        const { botToken, telegramMessages, fileName } = req.body;
        if (!botToken || !telegramMessages || !telegramMessages.length) {
            return res.status(400).json({ error: 'Missing download parameters' });
        }

        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        // Resolve all Telegram file paths concurrently
        const fileUrls = await Promise.all(
            telegramMessages.map(async (item) => {
                const meta = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${item.fileId}`);
                return `https://api.telegram.org/file/bot${botToken}/${meta.data.result.file_path}`;
            })
        );

        // Stream and pipe chunks sequentially in order to maintain file integrity at high speed
        for (const url of fileUrls) {
            const chunkRes = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 120000
            });

            await new Promise((resolve, reject) => {
                chunkRes.data.pipe(res, { end: false });
                chunkRes.data.on('end', resolve);
                chunkRes.data.on('error', reject);
            });
        }
        res.end();
    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.end();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
