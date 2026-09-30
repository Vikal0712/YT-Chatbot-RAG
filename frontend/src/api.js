import axios from "axios"

// Keep every frontend request pointed at the same FastAPI process.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"

export const processVideo = async (url) => {
    return axios.post(`${API_BASE_URL}/process_video`, null, {
        params: { url },
    })
}

export const askQuestion = async (question) => {
    return axios.post(`${API_BASE_URL}/ask`, null, {
        params: { question },
    })
}

export const getBackendStatus = async () => {
    return axios.get(`${API_BASE_URL}/status`)
}
