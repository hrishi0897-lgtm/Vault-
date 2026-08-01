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

// Robust chunk reassembler and downloader
app.post('/api/download', async (req, res) => {
    try {
        const { botToken, telegramMessages, fileName } = req.body;
        if (!botToken || !telegramMessages || !telegramMessages.length) {
            return res.status(400).json({ error: 'Missing download parameters' });
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        for (const item of telegramMessages) {
            if (!item || !item.fileId) continue;
            
            // Get valid download path from Telegram API
            const metaRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${item.fileId}`);
            if (!metaRes.data.ok || !metaRes.data.result.file_path) {
                throw new Error('Failed to resolve chunk file ID from Telegram');
            }
            
            const filePath = metaRes.data.result.file_path;
            const chunkUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

            const chunkRes = await axios({
                method: 'get',
                url: chunkUrl,
                responseType: 'stream',
                timeout: 120000
            });

            // Stream chunk safely to browser response
            await new Promise((resolve, reject) => {
                chunkRes.data.pipe(res, { end: false });
                chunkRes.data.on('end', resolve);
                chunkRes.data.on('error', reject);
            });
        }
        res.end();
    } catch (err) {
        console.error('Download error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.end();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
