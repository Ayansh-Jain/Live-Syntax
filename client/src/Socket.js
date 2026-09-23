import {io} from 'socket.io-client';

export const initSocket = async () =>{
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5002';
    
    console.log('Connecting to backend:', backendUrl);
    
    const options = {
        'force new connection': true,
        reconnectionAttempts : 'Infinity',
        timeout: 10000,
        transports: ['polling', 'websocket'],
    };
    return io(backendUrl, options);
}