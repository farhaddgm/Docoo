#!/usr/bin/env python3
"""Fails the DAST step on any open High (riskcode 3) ZAP alert (SEC-002 acceptance).

An alert is accepted only when every one of its instances matches an entry of
zap-accepted.json (plugin id + URL pattern) that records why it is acceptable.
"""
import json
import re
import sys
from pathlib import Path

accepted = json.loads((Path(__file__).parent / 'zap-accepted.json').read_text(encoding='utf-8'))


def is_accepted(alert):
    rules = [rule for rule in accepted if rule['pluginid'] == str(alert.get('pluginid'))]
    instances = alert.get('instances') or []
    return bool(rules) and bool(instances) and all(
        any(re.match(rule['uri'], instance.get('uri', '')) for rule in rules) for instance in instances
    )


blocking = []
for path in sys.argv[1:]:
    with open(path, encoding='utf-8') as handle:
        report = json.load(handle)
    for site in report.get('site', []):
        for alert in site.get('alerts', []):
            line = f"{path}: [{alert.get('riskdesc')}] {alert.get('name')} ({alert.get('pluginid')}) x{alert.get('count')}"
            if int(alert.get('riskcode', 0)) >= 3:
                if is_accepted(alert):
                    line += '  -> accepted (see zap-accepted.json)'
                else:
                    blocking.append(line)
            print(line)

if blocking:
    print('\nHigh-risk DAST findings:\n' + '\n'.join(blocking))
    sys.exit(1)
print('\nNo open high or critical DAST findings.')
