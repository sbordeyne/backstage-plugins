---
title: An NGINX deployment with 3 replicas
description: The label `app:nginx` matches the pods to the Deployment
---

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
```
