const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Config Constants
const DEVELOPER_NAME = 'Ramzan Ahsan';
const WHATSAPP_GROUP = 'https://chat.whatsapp.com/FiZBn0BykHX47d1iHLOay1';

// CORS Configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// External APIs
const TRUECALLER_API = 'https://faisal-ali-truecaller.ftgmhacks.workers.dev/?key=pak-digital.store&number=';
const NEW_SIMDATA_API = 'https://db-service-pk.vercel.app/api/search?query=';
const SIMDATA_BEARER_TOKEN = process.env.SIMDATA_TOKEN || 'hsmdz_2026_secure_9xAk!kL';

// Helper 1: Standardize for Truecaller API (Needs 923XXXXXXXXX format)
function formatForTruecaller(number) {
    if (!number) return '';
    let clean = number.toString().replace(/\D/g, '');
    if (clean.startsWith('0')) {
        clean = '92' + clean.substring(1);
    } else if (!clean.startsWith('92') && clean.length === 10) {
        clean = '92' + clean;
    }
    return clean;
}

// Helper 2: Standardize for SIM Database API (Needs 03XXXXXXXXX or 13-digit CNIC)
function formatForSIMAPI(query) {
    if (!query) return '';
    let clean = query.toString().replace(/\D/g, '');

    // CNIC (13 digits)
    if (clean.length === 13) {
        return clean;
    }

    // Convert 923XXXXXXXXX or 3XXXXXXXXX to 03XXXXXXXXX format
    if (clean.startsWith('92')) {
        clean = '0' + clean.substring(2);
    } else if (clean.length === 10 && clean.startsWith('3')) {
        clean = '0' + clean;
    }

    return clean;
}

// Truecaller API Fetch Function
async function getTruecallerData(number) {
    try {
        const cleanNum = formatForTruecaller(number);
        if (!cleanNum) return null;

        const response = await axios.get(TRUECALLER_API + cleanNum, { timeout: 6000 });
        if (response.data && response.data.data && response.data.data.name) {
            return {
                number: number,
                name: response.data.data.name
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

// New SIM Database API Fetch Function (Updated for db-service-pk.vercel.app)
async function getSIMData(query) {
    try {
        const formattedQuery = formatForSIMAPI(query);
        if (!formattedQuery) return null;

        const targetUrl = NEW_SIMDATA_API + encodeURIComponent(formattedQuery);
        const response = await axios.get(targetUrl, {
            timeout: 10000,
            headers: {
                'Authorization': `Bearer ${SIMDATA_BEARER_TOKEN}`,
                'Accept': 'application/json'
            }
        });

        const resData = response.data;

        if (!resData || resData.success === false) {
            return null;
        }

        // Extract array from response
        let rawItems = [];
        if (resData.data && Array.isArray(resData.data)) {
            rawItems = resData.data;
        } else if (Array.isArray(resData)) {
            rawItems = resData;
        } else if (typeof resData === 'object' && (resData.mobile || resData.number || resData.cnic)) {
            rawItems = [resData];
        }

        if (rawItems.length === 0) {
            return null;
        }

        let parsedData = [];

        rawItems.forEach(item => {
            const name = (item.name || item.full_name || '').toString().trim();
            const cnic = (item.cnic || item.CNIC || '').toString().trim();
            const address = (item.address || '').toString().replace(/\r/g, '').trim();
            const network = (item.network || item.operator || '').toString().trim();
            const num2Name = (item.Num2Name || '').toString().trim();

            if (Array.isArray(item.numbers) && item.numbers.length > 0) {
                item.numbers.forEach(num => {
                    let cleanNum = num.toString().replace(/\D/g, '');
                    if (cleanNum.startsWith('92')) {
                        cleanNum = '0' + cleanNum.substring(2);
                    } else if (cleanNum.length === 10 && cleanNum.startsWith('3')) {
                        cleanNum = '0' + cleanNum;
                    }
                    parsedData.push({
                        number: cleanNum,
                        name: name,
                        cnic: cnic,
                        address: address,
                        network: network,
                        _num2name: num2Name // Internal reference for fallback
                    });
                });
            } else {
                let numVal = item.mobile || item.number || item.phone || '';
                let cleanNum = numVal.toString().replace(/\D/g, '');
                if (cleanNum.startsWith('92')) {
                    cleanNum = '0' + cleanNum.substring(2);
                } else if (cleanNum.length === 10 && cleanNum.startsWith('3')) {
                    cleanNum = '0' + cleanNum;
                }

                parsedData.push({
                    number: cleanNum,
                    name: name,
                    cnic: cnic,
                    address: address,
                    network: network,
                    _num2name: num2Name // Internal reference for fallback
                });
            }
        });

        return parsedData.length > 0 ? parsedData : null;
    } catch (error) {
        return null;
    }
}

// Main Search Endpoint
app.get('/api/search', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a query (number or CNIC)',
                developer: DEVELOPER_NAME,
                group: WHATSAPP_GROUP
            });
        }

        const rawQuery = query.toString().trim();
        const digitsOnly = rawQuery.replace(/\D/g, '');

        const isCNIC = digitsOnly.length === 13;
        const formattedSIMQuery = formatForSIMAPI(rawQuery);
        const isNumber = /^03\d{9}$/.test(formattedSIMQuery);

        if (!isCNIC && !isNumber) {
            return res.status(400).json({
                success: false,
                message: 'Invalid query format. Provide a valid 13-digit CNIC or a Pakistani mobile number (e.g. 03XXXXXXXXX or 3XXXXXXXXX)',
                developer: DEVELOPER_NAME,
                group: WHATSAPP_GROUP
            });
        }

        let simDataResult = null;
        let fetchedCNIC = null;

        if (isCNIC) {
            simDataResult = await getSIMData(digitsOnly);
            fetchedCNIC = digitsOnly;
        } else if (isNumber) {
            // Step 1: Search using mobile number
            const initialData = await getSIMData(formattedSIMQuery);

            if (initialData && Array.isArray(initialData) && initialData.length > 0) {
                // Extract CNIC from initial number lookup
                for (const rec of initialData) {
                    const cnicVal = rec.cnic;
                    if (cnicVal) {
                        const cleanCnic = cnicVal.toString().replace(/\D/g, '');
                        if (cleanCnic.length === 13) {
                            fetchedCNIC = cleanCnic;
                            break;
                        }
                    }
                }

                // Step 2: Fetch all numbers registered on that CNIC
                if (fetchedCNIC) {
                    const cnicData = await getSIMData(fetchedCNIC);
                    simDataResult = (cnicData && Array.isArray(cnicData) && cnicData.length > 0) ? cnicData : initialData;
                } else {
                    simDataResult = initialData;
                }
            }
        }

        let multiData = [];
        let numbersList = [];
        let fallbackCallerNames = {};

        if (simDataResult && Array.isArray(simDataResult)) {
            // Keep exact original object structure for sim_data while storing _num2name for fallback
            multiData = simDataResult.map(item => {
                if (item.number && item._num2name) {
                    fallbackCallerNames[item.number] = item._num2name;
                }
                return {
                    number: item.number,
                    name: item.name,
                    cnic: item.cnic,
                    address: item.address,
                    network: item.network
                };
            });
            numbersList = multiData.map(item => item.number).filter(Boolean);
        }

        // Truecaller Logic Execution (with fallback to Num2Name from new API if Truecaller times out/fails)
        let truecallerResults = [];

        if (numbersList.length > 0) {
            const limitedNumbers = [...new Set(numbersList)].slice(0, 7);
            const promises = limitedNumbers.map(async (num) => {
                const tc = await getTruecallerData(num);
                if (tc) return tc;
                if (fallbackCallerNames[num]) {
                    return { number: num, name: fallbackCallerNames[num] };
                }
                return null;
            });
            const results = await Promise.all(promises);
            truecallerResults = results.filter(item => item !== null);
        } else if (isNumber) {
            const tcData = await getTruecallerData(rawQuery);
            if (tcData) {
                truecallerResults.push(tcData);
            }
        }

        return res.json({
            success: true,
            developer: DEVELOPER_NAME,
            group: WHATSAPP_GROUP,
            query: rawQuery,
            query_type: isCNIC ? 'CNIC' : 'NUMBER',
            extracted_cnic: fetchedCNIC || 'N/A',
            total_numbers_found: multiData.length,
            sim_data: multiData,
            truecaller_data: truecallerResults
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error processing request',
            error: error.message,
            developer: DEVELOPER_NAME,
            group: WHATSAPP_GROUP
        });
    }
});

// Health check Endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'API is running',
        developer: DEVELOPER_NAME,
        group: WHATSAPP_GROUP
    });
});

// Root Endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'SIM Multi-Data & Truecaller API',
        endpoints: {
            search: '/api/search?query=YOUR_NUMBER_OR_CNIC',
            health: '/api/health'
        },
        developer: DEVELOPER_NAME,
        group: WHATSAPP_GROUP
    });
});

// Local Testing
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
