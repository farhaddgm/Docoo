# ClamAV test signature

`test-signatures/docoo-test.ndb` holds a single body signature for the standard EICAR test
string. CI starts `clamd` with only this database so malware-scan tests are deterministic and
need no signature download. Production and local development use the official signatures
(`freshclam`, see the `malware-scanner` service in `compose.yaml`); never deploy with only
this file.
