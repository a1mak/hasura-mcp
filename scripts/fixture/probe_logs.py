import json, subprocess, time

E = "http://localhost:8299"


def post(path, body):
    out = subprocess.run(
        ["curl", "-s", "-H", "content-type: application/json",
         "-H", "x-hasura-admin-secret: fixture", "-d", json.dumps(body), E + path],
        capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {"_raw": out[:500]}


def sql(q):
    return post("/v2/query", {"type": "run_sql",
                              "args": {"source": "default", "read_only": True, "sql": q}})


print("### fire the trigger (webhook points at example.invalid, so it will fail)")
r = post("/v1/graphql", {"query": 'mutation { insert_patient_consent_one(object:{patient_id:"33333333-3333-3333-3333-333333333333"}) { id } }'})
print(json.dumps(r)[:160])
time.sleep(8)

print("\n### event_log columns")
c = sql("select column_name, data_type from information_schema.columns "
        "where table_schema='hdb_catalog' and table_name='event_log' order by ordinal_position;")
print([f"{a}:{b}" for a, b, *_ in c["result"][1:]])

print("\n### event_invocation_logs columns")
c = sql("select column_name, data_type from information_schema.columns "
        "where table_schema='hdb_catalog' and table_name='event_invocation_logs' order by ordinal_position;")
print([f"{a}:{b}" for a, b, *_ in c["result"][1:]])

print("\n### a real row: delivery state")
c = sql("select trigger_name, delivered, error, tries, created_at "
        "from hdb_catalog.event_log order by created_at desc limit 3;")
print(json.dumps(c.get("result"), indent=1)[:700])

print("\n### a real invocation: what the failure looks like")
c = sql("select status, left(response::text, 220) as response, created_at "
        "from hdb_catalog.event_invocation_logs order by created_at desc limit 2;")
print(json.dumps(c.get("result"), indent=1)[:800])

print("\n### summary shape the tool would return")
c = sql("""select trigger_name,
                  count(*) filter (where delivered) as delivered,
                  count(*) filter (where not delivered and not coalesce(error,false)) as pending,
                  count(*) filter (where coalesce(error,false)) as failed
           from hdb_catalog.event_log group by trigger_name;""")
print(json.dumps(c.get("result"), indent=1)[:400])

print("\n### cron / scheduled / action log columns (do they differ?)")
for t in ("hdb_cron_events", "hdb_scheduled_events", "hdb_action_log"):
    c = sql(f"select column_name from information_schema.columns "
            f"where table_schema='hdb_catalog' and table_name='{t}' order by ordinal_position;")
    print(f"  {t}: {[a for a, *_ in c['result'][1:]]}")

print("\n### is there a metadata API to introspect a remote schema?")
for t in ("introspect_remote_schema", "get_remote_schema_info"):
    r = post("/v1/metadata", {"type": t, "args": {"name": "self_remote"}})
    print(f"  {t} -> {json.dumps(r)[:200]}")
