const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
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

        const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks
        const fileBuffer = fs.readFileSync(file.path);
        const totalParts = Math.ceil(file.size / CHUNK_SIZE);
        const telegramMessages = [];

        for (let i = 0; i < totalParts; i++) {
            const chunk = fileBuffer.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('document', chunk, { filename: `${file.originalname}.part${i + 1}` });

            const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendDocument`, formData, {
                headers: formData.getHeaders(),
                maxContentLength: Infinity, 
                maxBodyLength: Infinity
            });
            if (response.data.ok) {
                telegramMessages.push({ fileId: response.data.result.document.file_id });
            }
        }
        fs.unlinkSync(file.path);
        res.json({ success: true, fileName: file.originalname, size: file.size, parts: totalParts, telegramMessages });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/download', async (req, res) => {
    try {
        const { botToken, telegramMessages, fileName } = req.body;
        let buffers = [];
        for (const item of telegramMessages) {
            const meta = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${item.fileId}`);
            const chunkRes = await axios.get(`https://api.telegram.org/file/bot${botToken}/${meta.data.result.file_path}`, { responseType: 'arraybuffer' });
            buffers.push(Buffer.from(chunkRes.data));
        }
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(Buffer.concat(buffers));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
