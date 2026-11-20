import subprocess
import sys
import time

# 1. Start Tier 2 (Central SaaS - Port 8002)
p2 = subprocess.Popen([sys.executable, "tier2_saas/app/main.py"])
time.sleep(2)

# 2. Start Tier 1 (Local Collector - Port 8001)
p1 = subprocess.Popen([sys.executable, "tier1_collector/app/main.py"])

# 3. Start Next.js Enterprise Frontend (Port 3000)
p3 = subprocess.Popen("npm run dev", cwd="frontend-next", shell=True)

print("\n===================================================")
print("NEXT.JS DASHBOARD:   http://localhost:3000")
print("Tier 2 SaaS API:     http://127.0.0.1:8002/docs")
print("Tier 1 Egress Proof: http://127.0.0.1:8001/api/local/egress-proof")
print("===================================================\n")

try:
    p2.wait()
    p1.wait()
    p3.wait()
except KeyboardInterrupt:
    p1.terminate()
    p2.terminate()
    p3.terminate()