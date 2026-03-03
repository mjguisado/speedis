    "origin": {
        "http1xOptions": {
            "host": "mocks",
            "port": 3030,
            "timeout": 1000
        },
        "agentOptions": {
            "keepAlive": true
        },  
        "originTimeout": 1000,
        "originBreaker": true,
        "originBreakerOptions": {
            "errorThresholdPercentage": 25,
            "resetTimeout": 2000
        }
    },   
   
   
    "origin": {
        "http2Options": {
            "authority": "https://mocks2:3030",
            "options": {
                "rejectUnauthorized": false,
                "timeout": 1000
            }
        },
        "originTimeout": 1000,
        "originBreaker": true,
        "originBreakerOptions": {
            "errorThresholdPercentage": 25,
            "resetTimeout": 2000
        }
    },