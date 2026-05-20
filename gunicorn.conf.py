import os

port         = os.environ.get('PORT', '8000')
bind         = f'0.0.0.0:{port}'
workers      = min(int(os.environ.get('WEB_CONCURRENCY', 2)), 4)
worker_class = 'gthread'
threads      = 4
timeout      = 120
keepalive    = 5
graceful_timeout = 30
backlog      = 64
accesslog    = '-'
errorlog     = '-'
loglevel     = os.environ.get('LOG_LEVEL', 'info')
capture_output      = True
forwarded_allow_ips = '*'
proc_name    = 'finledger_pro'
preload_app  = True
