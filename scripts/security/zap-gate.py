#!/usr/bin/env python3
"""Fails the DAST step on any open High (riskcode 3) ZAP alert (SEC-002 acceptance)."""
import json
import sys

blocking = []
for path in sys.argv[1:]:
    with open(path, encoding='utf-8') as handle:
        report = json.load(handle)
    for site in report.get('site', []):
        for alert in site.get('alerts', []):
            line = f"{path}: [{alert.get('riskdesc')}] {alert.get('name')} ({alert.get('pluginid')}) x{alert.get('count')}"
            print(line)
            if int(alert.get('riskcode', 0)) >= 3:
                blocking.append(line)

if blocking:
    print('\nHigh-risk DAST findings:\n' + '\n'.join(blocking))
    sys.exit(1)
print('\nNo high or critical DAST findings.')
