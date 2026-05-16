import multiprocessing
import os

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
workers = int(os.getenv("GUNICORN_WORKERS", min(multiprocessing.cpu_count() * 2 + 1, 9)))
worker_class = "uvicorn.workers.UvicornWorker"
worker_tmp_dir = "/dev/shm"

# Timeouts
timeout = 120
graceful_timeout = 30
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

# Restart workers periodically to prevent memory leaks
max_requests = 2000
max_requests_jitter = 200

# Preload app for faster worker startup and shared memory
preload_app = True

# Forward proxy headers
forwarded_allow_ips = "*"
proxy_protocol = False
